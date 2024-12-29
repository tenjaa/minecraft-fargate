import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { CfnParameter } from "aws-cdk-lib";
import { LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import {
  ContainerImage,
  Ec2TaskDefinition,
  LogDriver,
  NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import type * as ssm from "aws-cdk-lib/aws-ssm";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

export class MinecraftStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const opUsername = new CfnParameter(this, "opUsername");
    const duckDnsSubDomain = new CfnParameter(this, "duckDnsSubDomain");
    const duckDnsToken: ssm.IParameter =
      StringParameter.fromSecureStringParameterAttributes(
        this,
        "duckDnsToken",
        {
          parameterName: "duckDnsToken",
          version: 1,
        },
      );

    const bucket = new Bucket(this, "serverDataBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(7),
        },
      ],
    });

    const vpc = new ec2.Vpc(this, "vpc", {
      maxAzs: 99,
      subnetConfiguration: [
        {
          name: "mc-subnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const securityGroup = new ec2.SecurityGroup(this, "mc-secGroup", {
      vpc: vpc,
      securityGroupName: "mc-service-securityGroup",
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(25565));

    const cluster = new ecs.Cluster(this, "mc-cluster", {
      vpc: vpc,
    });
    const autoScalingGroup = cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL),
      desiredCapacity: 0,
      minCapacity: 0,
      maxCapacity: 1,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.ARM),
    });
    autoScalingGroup.addSecurityGroup(securityGroup);

    const taskDefinition = new Ec2TaskDefinition(this, "taskDefinition", {
      networkMode: NetworkMode.HOST,
    });

    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
        resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
      }),
    );
    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:DescribeTasks"],
        resources: [
          `${this.formatArn({
            service: "ecs",
            resource: "task",
          })}/*`,
        ],
      }),
    );
    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:ListServices"],
        resources: ["*"],
        conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
      }),
    );
    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["autoscaling:SetDesiredCapacity"],
        resources: [autoScalingGroup.autoScalingGroupArn],
      }),
    );

    const asset = new DockerImageAsset(this, "Image", {
      assetName: "minecraft",
      directory: path.join(__dirname, "..", "image"),
      platform: Platform.LINUX_ARM64,
    });

    const containerDefinition = taskDefinition.addContainer("container", {
      image: ContainerImage.fromDockerImageAsset(asset),
      environment: {
        ASG: autoScalingGroup.autoScalingGroupName,
        BUCKET: bucket.bucketName,
        CLUSTER_ARN: cluster.clusterArn,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        OP_USERNAME: opUsername.valueAsString,
      },
      secrets: {
        DUCK_DNS_TOKEN: ecs.Secret.fromSsmParameter(duckDnsToken),
      },
      logging: LogDriver.awsLogs({
        streamPrefix: "mc-logs",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      stopTimeout: cdk.Duration.seconds(120),
      memoryReservationMiB: 1024,
    });
    containerDefinition.addPortMappings({
      containerPort: 25565,
    });

    const mcService = new ecs.Ec2Service(this, "service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: "mc-service",
      desiredCount: 0,
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    taskDefinition.addToTaskRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:UpdateService"],
        resources: ["*"],
        conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
      }),
    );

    const startServerLambda = new NodejsFunction(this, "mc-start-server", {
      entry: path.join(__dirname, "..", "src", "start-server.handler.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        BUCKET: bucket.bucketName,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        MC_CLUSTER: cluster.clusterArn,
        MC_SERVICE: mcService.serviceArn,
        ASG: autoScalingGroup.autoScalingGroupName,
      },
      architecture: lambda.Architecture.ARM_64,
      logRetention: RetentionDays.ONE_WEEK,
    });
    startServerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:UpdateService", "ecs:DescribeServices"],
        resources: [mcService.serviceArn],
        conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
      }),
    );
    startServerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:ListBucket"],
        resources: [bucket.bucketArn],
      }),
    );
    startServerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["autoscaling:SetDesiredCapacity"],
        resources: [autoScalingGroup.autoScalingGroupArn],
      }),
    );
    startServerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["autoscaling:DescribeAutoScalingGroups"],
        resources: ["*"],
      }),
    );
    startServerLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ec2:DescribeInstances"],
        resources: ["*"],
      }),
    );

    const api = new RestApi(this, "mc-management-api");
    api.root.addMethod("GET", new LambdaIntegration(startServerLambda));
  }
}

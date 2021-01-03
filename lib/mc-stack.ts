import * as cdk from '@aws-cdk/core';
import {CfnOutput, CfnParameter} from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import {InstanceClass, InstanceSize, InstanceType, SubnetType} from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import {ContainerImage, Ec2TaskDefinition, EcsOptimizedImage, LogDriver, NetworkMode} from "@aws-cdk/aws-ecs";
import {Effect, PolicyStatement} from '@aws-cdk/aws-iam';
import {BlockPublicAccess, Bucket} from '@aws-cdk/aws-s3';
import {Code, Function, Runtime} from '@aws-cdk/aws-lambda';
import {LambdaIntegration, RestApi} from '@aws-cdk/aws-apigateway';
import {DockerImageAsset} from '@aws-cdk/aws-ecr-assets';
import * as path from 'path';
import {AutoScalingGroup} from '@aws-cdk/aws-autoscaling';
import {RetentionDays} from '@aws-cdk/aws-logs';
import {IParameter, StringParameter} from '@aws-cdk/aws-ssm';
import * as ssm from '@aws-cdk/aws-ssm';

export class McStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const opUsername = new CfnParameter(this, "opUsername");
    const duckDnsSubDomain = new CfnParameter(this, "duckDnsSubDomain");
    const duckDnsToken: ssm.IParameter = StringParameter.fromSecureStringParameterAttributes(this, "duckDnsToken", {
      parameterName: "duckDnsToken",
      version: 1
    });

    const bucket = new Bucket(this, "serverDataBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [{
        noncurrentVersionExpiration: cdk.Duration.days(7)
      }]
    })

    const vpc = new ec2.Vpc(this, "vpc", {
      maxAzs: 99,
      subnetConfiguration: [
        {
          name: "mc-subnet",
          subnetType: SubnetType.PUBLIC
        }
      ]
    });

    const securityGroup = new ec2.SecurityGroup(this, "mc-secGroup", {
      vpc: vpc,
      securityGroupName: "mc-service-securityGroup"
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(25565))

    const autoScalingGroup = new AutoScalingGroup(this, "asg", {
      instanceType: InstanceType.of(InstanceClass.T3A, InstanceSize.SMALL),
      machineImage: EcsOptimizedImage.amazonLinux2(),
      vpc: vpc,
      minCapacity: 0,
      desiredCapacity: 0,
      maxCapacity: 1,
      securityGroup: securityGroup,
      spotPrice: "0.02"
    });

    const cluster = new ecs.Cluster(this, "mc-cluster", {
      vpc: vpc,
    });

    cluster.addAutoScalingGroup(autoScalingGroup);

    const taskDefinition = new Ec2TaskDefinition(this, "taskDefinition", {networkMode: NetworkMode.HOST});

    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      resources: [bucket.bucketArn, bucket.bucketArn + "/*"]
    }))
    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:DescribeTasks"],
      resources: [this.formatArn({
        service: "ecs",
        resource: "task"
      }) + "/*"]
    }))
    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:ListServices"],
      resources: ["*"],
      conditions: {ArnEquals: {"ecs:cluster": cluster.clusterArn}}
    }))
    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["autoscaling:SetDesiredCapacity"],
      resources: [autoScalingGroup.autoScalingGroupArn]
    }))

    const asset = new DockerImageAsset(this, 'mcImage', {
      directory: path.join(__dirname, '..', 'image'),
    });

    const containerDefinition = taskDefinition.addContainer("container", {
      image: ContainerImage.fromDockerImageAsset(asset),
      environment: {
        ASG: autoScalingGroup.autoScalingGroupName,
        BUCKET: bucket.bucketName,
        CLUSTER_ARN: cluster.clusterArn,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        OP_USERNAME: opUsername.valueAsString
      },
      secrets: {
        DUCK_DNS_TOKEN: ecs.Secret.fromSsmParameter(duckDnsToken)
      },
      logging: LogDriver.awsLogs({
        streamPrefix: "mc-logs",
        logRetention: RetentionDays.ONE_WEEK
      }),
      stopTimeout: cdk.Duration.seconds(120),
      memoryReservationMiB: 1024,
    });
    containerDefinition.addPortMappings({
      containerPort: 25565
    })

    const mcService = new ecs.Ec2Service(this, "service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: "mc-service",
      desiredCount: 0,
      minHealthyPercent: 0,
      maxHealthyPercent: 100
    });

    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:UpdateService"],
      resources: [mcService.serviceArn],
      conditions: {ArnEquals: {"ecs:cluster": cluster.clusterArn}}
    }))

    const startServerLambda = new Function(this, "mc-start-server", {
      handler: "startServer.handler",
      runtime: Runtime.NODEJS_12_X,
      code: Code.fromAsset("src"),
      environment: {
        BUCKET: bucket.bucketName,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        MC_CLUSTER: cluster.clusterArn,
        MC_SERVICE: mcService.serviceArn,
        ASG: autoScalingGroup.autoScalingGroupName
      },
      logRetention: RetentionDays.ONE_WEEK
    })
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:UpdateService", "ecs:DescribeServices"],
      resources: [mcService.serviceArn],
      conditions: {ArnEquals: {"ecs:cluster": cluster.clusterArn}}
    }))
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:ListBucket"],
      resources: [bucket.bucketArn]
    }))
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["autoscaling:SetDesiredCapacity"],
      resources: [autoScalingGroup.autoScalingGroupArn]
    }))
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["autoscaling:DescribeAutoScalingGroups"],
      resources: ["*"]
    }))

    const api = new RestApi(this, "mc-management-api");
    api.root.addMethod("GET", new LambdaIntegration(startServerLambda))

    new CfnOutput(this, "serverBucketOutput", {
      value: bucket.bucketName
    })
  }
}

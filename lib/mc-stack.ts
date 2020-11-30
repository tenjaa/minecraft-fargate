import * as cdk from '@aws-cdk/core';
import {CfnOutput, CfnParameter} from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import {SubnetType} from "@aws-cdk/aws-ec2";
import * as ecs from "@aws-cdk/aws-ecs";
import {CfnCluster, CfnService, Compatibility, ContainerImage, LogDriver} from "@aws-cdk/aws-ecs";
import {Effect, PolicyStatement} from '@aws-cdk/aws-iam';
import {BlockPublicAccess, Bucket} from '@aws-cdk/aws-s3';
import {Code, Function, Runtime} from '@aws-cdk/aws-lambda';
import {LambdaIntegration, RestApi} from '@aws-cdk/aws-apigateway';
import {Secret} from '@aws-cdk/aws-secretsmanager';
import {DockerImageAsset} from '@aws-cdk/aws-ecr-assets';
import * as path from 'path';

export class McStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cpu = new CfnParameter(this, "cpu", {
      default: 2048
    });
    const memoryMiB = new CfnParameter(this, "memoryMiB", {
      default: 4096
    });
    const duckDnsSubDomain = new CfnParameter(this, "duckDnsSubDomain");
    const duckDnsToken = Secret.fromSecretNameV2(this, "duckDnsToken", "mcDuckDnsToken");

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

    const cluster = new ecs.Cluster(this, "mc-cluster", {
      clusterName: "mc-cluster",
      vpc: vpc
    });

    const cfnCluster = cluster.node.defaultChild as CfnCluster;
    cfnCluster.capacityProviders = ['FARGATE_SPOT'];

    const taskDefinition = new ecs.TaskDefinition(this, "mc-task", {
      compatibility: Compatibility.FARGATE,
      cpu: cpu.valueAsString,
      memoryMiB: memoryMiB.valueAsString
    });

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
      actions: ["ec2:DescribeNetworkInterfaces"],
      resources: ["*"]
    }))
    taskDefinition.addToTaskRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:ListServices"],
      resources: ["*"],
      conditions: {ArnEquals: {"ecs:cluster": cluster.clusterArn}}
    }))

    const asset = new DockerImageAsset(this, 'mcImage', {
      directory: path.join(__dirname, '..', 'image'),
    });

    const containerDefinition = taskDefinition.addContainer("mcContainer", {
      image: ContainerImage.fromDockerImageAsset(asset),
      environment: {
        "BUCKET": bucket.bucketName,
        "DUCK_DNS_DOMAIN": duckDnsSubDomain.valueAsString,
      },
      secrets: {
        "DUCK_DNS_TOKEN": ecs.Secret.fromSecretsManager(duckDnsToken)
      },
      logging: LogDriver.awsLogs({
        streamPrefix: "mc-logs"
      }),
      stopTimeout: cdk.Duration.seconds(120)
    });
    containerDefinition.addPortMappings({
      containerPort: 25565
    })

    const securityGroup = new ec2.SecurityGroup(this, "mc-secGroup", {
      vpc: vpc,
      securityGroupName: "mc-service-securityGroup"
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(25565))

    const mcService = new ecs.FargateService(this, "mc-service", {
      cluster: cluster,
      taskDefinition: taskDefinition,
      serviceName: "mc-service",
      desiredCount: 0,
      assignPublicIp: true,
      securityGroups: [securityGroup]
    });

    const cfnService = mcService.node.children[0] as CfnService;
    cfnService.launchType = undefined
    cfnService.capacityProviderStrategy = [{
      capacityProvider: "FARGATE_SPOT",
      weight: 1000
    }]

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
      }
    })
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ecs:UpdateService"],
      resources: [mcService.serviceArn]
    }))
    startServerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:ListBucket"],
      resources: [bucket.bucketArn]
    }))

    const api = new RestApi(this, "mc-management-api");
    api.root.addMethod("GET", new LambdaIntegration(startServerLambda))

    new CfnOutput(this, "serverBucketOutput", {
      value: bucket.bucketName
    })
  }
}

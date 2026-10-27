import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { CfnParameter, Duration } from "aws-cdk-lib";
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { FeaturePlan, UserPool } from "aws-cdk-lib/aws-cognito";
import type { TableV2 } from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { InstanceClass, InstanceSize, InstanceType } from "aws-cdk-lib/aws-ec2";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import {
  AwsLogDriver,
  ContainerImage,
  Ec2TaskDefinition,
  NetworkMode,
} from "aws-cdk-lib/aws-ecs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  FilterPattern,
  RetentionDays,
  SubscriptionFilter,
} from "aws-cdk-lib/aws-logs";
import { LambdaDestination } from "aws-cdk-lib/aws-logs-destinations";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import type * as ssm from "aws-cdk-lib/aws-ssm";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { Build, NODEJS_BUNDLING_BANNER } from "../bin/build.ts";

import NODE_LAMBDA_RUNTIME = Build.NODE_LAMBDA_RUNTIME;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MinecraftStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: cdk.StackProps & { table: TableV2 },
  ) {
    super(scope, id, props);

    const opUsername = new CfnParameter(this, "opUsername", {
      allowedPattern: "[A-Za-z0-9_]{3,16}",
    });
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

    const rconPassword = StringParameter.fromSecureStringParameterAttributes(
      this,
      "RconPassword",
      {
        parameterName: "/minecraft/rcon-password",
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
    const rconSecurityGroup = new ec2.SecurityGroup(this, "rcon-secGroup", {
      vpc,
      allowAllOutbound: false,
      disableInlineRules: true,
      description: "RCON executor: only connect to the Minecraft RCON port",
    });
    securityGroup.addIngressRule(
      rconSecurityGroup,
      ec2.Port.tcp(25575),
      "RCON only from the executor Lambda",
    );
    rconSecurityGroup.addEgressRule(securityGroup, ec2.Port.tcp(25575));

    const cluster = new ecs.Cluster(this, "mc-cluster", {
      vpc: vpc,
    });
    const autoScalingGroup = cluster.addCapacity("DefaultAutoScalingGroup", {
      instanceType: InstanceType.of(InstanceClass.T4G, InstanceSize.MEDIUM),
      desiredCapacity: 0,
      minCapacity: 0,
      maxCapacity: 1,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2023(
        ecs.AmiHardwareType.ARM,
      ),
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

    const minecraftLogging = new AwsLogDriver({
      streamPrefix: "mc-logs",
      logRetention: RetentionDays.ONE_WEEK,
    });
    const containerDefinition = taskDefinition.addContainer("container", {
      image: ContainerImage.fromDockerImageAsset(asset),
      environment: {
        ASG: autoScalingGroup.autoScalingGroupName,
        BUCKET: bucket.bucketName,
        CLUSTER_ARN: cluster.clusterArn,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        OP_USERNAME: opUsername.valueAsString,
        AWS_DEFAULT_REGION: this.region,
      },
      secrets: {
        DUCK_DNS_TOKEN: ecs.Secret.fromSsmParameter(duckDnsToken),
        RCON_PASSWORD: ecs.Secret.fromSsmParameter(rconPassword),
      },
      logging: minecraftLogging,
      stopTimeout: cdk.Duration.seconds(120),
      memoryReservationMiB: 1500,
    });
    containerDefinition.addPortMappings(
      { containerPort: 25565 },
      { containerPort: 25575 },
    );

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
      functionName: "start-server",
      entry: path.join(
        __dirname,
        "..",
        "src",
        "lambdas",
        "start-server.handler.ts",
      ),
      runtime: NODE_LAMBDA_RUNTIME,
      environment: {
        BUCKET: bucket.bucketName,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        MC_CLUSTER: cluster.clusterArn,
        MC_SERVICE: mcService.serviceArn,
        ASG: autoScalingGroup.autoScalingGroupName,
      },
      architecture: lambda.Architecture.ARM_64,
      logRetention: RetentionDays.ONE_WEEK,
      memorySize: 512,
      timeout: Duration.seconds(10),
      bundling: {
        format: OutputFormat.ESM,
        banner: NODEJS_BUNDLING_BANNER,
      },
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
    bucket.grantRead(startServerLambda, "mods/*");

    const userPool = new UserPool(this, "UserPool", {
      signInCaseSensitive: false,
      featurePlan: FeaturePlan.ESSENTIALS,
      signInAliases: {
        username: false,
        email: true,
        phone: false,
        preferredUsername: false,
      },
      signInPolicy: {
        allowedFirstAuthFactors: {
          password: true,
          emailOtp: true,
        },
      },
    });
    userPool.addDomain("CognitoDomain", {
      cognitoDomain: {
        domainPrefix: "tenjaa-mc",
      },
    });
    const userPoolClient = userPool.addClient("Client", {
      disableOAuth: true,
      preventUserExistenceErrors: true,
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(7),
      enableTokenRevocation: true,
      authFlows: {
        user: true,
      },
    });

    const profileEnvironment = {
      PROFILE_TABLE: props.table.tableName,
      USER_POOL_ID: userPool.userPoolId,
      OP_USERNAME: opUsername.valueAsString,
    };
    const rconLambda = new NodejsFunction(this, "mc-rcon", {
      entry: path.join(__dirname, "..", "src", "lambdas", "rcon.handler.ts"),
      runtime: NODE_LAMBDA_RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: RetentionDays.ONE_WEEK,
      vpc,
      // No public IP or internet access is needed: this function only uses RCON.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      allowPublicSubnet: true,
      securityGroups: [rconSecurityGroup],
      bundling: {
        format: OutputFormat.ESM,
        banner: NODEJS_BUNDLING_BANNER,
      },
    });
    const profileLambda = new NodejsFunction(this, "mc-profile", {
      entry: path.join(__dirname, "..", "src", "lambdas", "profile.handler.ts"),
      runtime: NODE_LAMBDA_RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(29),
      memorySize: 256,
      logRetention: RetentionDays.ONE_WEEK,
      environment: profileEnvironment,
      bundling: {
        format: OutputFormat.ESM,
        banner: NODEJS_BUNDLING_BANNER,
        bundleAwsSDK: true,
      },
    });
    const allowlistLambda = new NodejsFunction(this, "mc-allowlist", {
      entry: path.join(
        __dirname,
        "..",
        "src",
        "lambdas",
        "allowlist.handler.ts",
      ),
      runtime: NODE_LAMBDA_RUNTIME,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(55),
      reservedConcurrentExecutions: 1,
      memorySize: 256,
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        ...profileEnvironment,
        MC_CLUSTER: cluster.clusterArn,
        MC_SERVICE_NAME: mcService.serviceName,
        RCON_FUNCTION: rconLambda.functionName,
        RCON_PASSWORD_PARAMETER: rconPassword.parameterName,
      },
      bundling: {
        format: OutputFormat.ESM,
        banner: NODEJS_BUNDLING_BANNER,
        bundleAwsSDK: true,
      },
    });
    for (const fn of [profileLambda, allowlistLambda]) {
      props.table.grantReadData(fn);
      fn.addToRolePolicy(
        new PolicyStatement({
          actions: ["cognito-idp:AdminGetUser"],
          resources: [userPool.userPoolArn],
        }),
      );
    }
    props.table.grantReadWriteData(profileLambda);
    props.table.grantReadWriteData(allowlistLambda);
    rconPassword.grantRead(allowlistLambda);
    rconLambda.grantInvoke(allowlistLambda);
    profileLambda.addEnvironment(
      "ALLOWLIST_FUNCTION",
      allowlistLambda.functionName,
    );
    allowlistLambda.grantInvoke(profileLambda);
    allowlistLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ecs:ListTasks"],
        resources: ["*"],
        conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
      }),
    );
    for (const [action, resource] of [
      ["ecs:DescribeTasks", "task"],
      ["ecs:DescribeContainerInstances", "container-instance"],
    ]) {
      allowlistLambda.addToRolePolicy(
        new PolicyStatement({
          actions: [action],
          resources: [
            this.formatArn({
              service: "ecs",
              resource,
              resourceName: `${cluster.clusterName}/*`,
              arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
            }),
          ],
          conditions: { ArnEquals: { "ecs:cluster": cluster.clusterArn } },
        }),
      );
    }
    allowlistLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ec2:DescribeInstances"],
        resources: ["*"],
      }),
    );
    new SubscriptionFilter(this, "AllowlistAfterStartup", {
      logGroup: minecraftLogging.logGroup!,
      // ECS RUNNING happens before Minecraft is ready to accept RCON commands.
      filterPattern: FilterPattern.literal('"RCON running on"'),
      destination: new LambdaDestination(allowlistLambda),
    });

    const httpApi = new HttpApi(this, "Api", {
      corsPreflight: {
        allowHeaders: ["Authorization", "Content-Type"],
        allowOrigins: ["https://tenjaa.github.io"],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.DELETE,
        ],
        maxAge: Duration.hours(1),
      },
      defaultAuthorizer: new HttpUserPoolAuthorizer("Authorizer", userPool, {
        userPoolClients: [userPoolClient],
      }),
    });

    httpApi.addRoutes({
      methods: [HttpMethod.GET, HttpMethod.POST],
      path: "/",
      integration: new HttpLambdaIntegration(
        "LambdaIntegration",
        startServerLambda,
      ),
    });
    httpApi.addRoutes({
      methods: [HttpMethod.GET, HttpMethod.PUT, HttpMethod.DELETE],
      path: "/profile",
      integration: new HttpLambdaIntegration(
        "ProfileIntegration",
        profileLambda,
      ),
    });

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
  }
}

import * as cdk from '@aws-cdk/core';
import {CfnOutput, CfnParameter} from '@aws-cdk/core';
import {Asset} from '@aws-cdk/aws-s3-assets';
import * as ec2 from "@aws-cdk/aws-ec2";
import {
  AmazonLinuxGeneration,
  AmazonLinuxImage,
  CloudFormationInit,
  InitCommand,
  InitFile,
  InitService,
  InitSource,
  InstanceClass,
  InstanceSize,
  InstanceType,
  SubnetType,
  UserData
} from "@aws-cdk/aws-ec2";
import {Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from '@aws-cdk/aws-iam';
import {BlockPublicAccess, Bucket} from '@aws-cdk/aws-s3';
import {Code, Function, Runtime} from '@aws-cdk/aws-lambda';
import {LambdaIntegration, RestApi} from '@aws-cdk/aws-apigateway';
import {Secret} from '@aws-cdk/aws-secretsmanager';
import {AutoScalingGroup, Signals} from '@aws-cdk/aws-autoscaling';
import * as path from 'path';

export class McStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const forgeVersion = new CfnParameter(this, "forgeVersion", {default: '1.16.4-35.1.3'})

    const duckDnsSubDomain = new CfnParameter(this, "duckDnsSubDomain");
    const duckDnsToken = Secret.fromSecretNameV2(this, "duckDnsToken", "mcDuckDnsToken");

    const bucket = new Bucket(this, "serverDataBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [{
        noncurrentVersionExpiration: cdk.Duration.days(7)
      }]
    })

    // TODO: Gateway endpoint?
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
      securityGroupName: "mc-service-securityGroup",
      allowAllOutbound: true
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(25565))
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22))

    const role = new Role(this, "role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com")
    });
    role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
      resources: [bucket.bucketArn, bucket.bucketArn + "/*"]
    }))
    role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"],
      resources: ["*"]
    }))
    role.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ec2-instance-connect:SendSSHPublicKey", "ec2:DescribeInstances"],
      resources: ["*"]
    }))
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"))

    const scripts = new Asset(this, "scripts", {
      path: path.join('resources', 'scripts')
    });

    const cloudFormationInit = CloudFormationInit.fromConfigSets({
      configSets: {
        default: ['setup', 'installForge', 'chown', 'enableService'],
      },
      configs: {
        setup: new ec2.InitConfig([
          InitSource.fromExistingAsset("/home/ec2-user/scripts", scripts),
          InitFile.fromUrl("/home/ec2-user/forge-installer.jar", "https://files.minecraftforge.net/maven/net/minecraftforge/forge/" + forgeVersion.valueAsString + "/forge-" + forgeVersion.valueAsString + "-installer.jar"),
          InitFile.fromString("/home/ec2-user/eula.txt", "eula=true"),
          InitFile.fromFileInline("/etc/systemd/system/minecraft.service", "resources/minecraft.service"),
          InitFile.fromFileInline("/etc/systemd/system/minecraft.socket", "resources/minecraft.socket"),
          InitFile.fromString(
            "/etc/systemd/system/minecraft.service.d/env.conf",
            "[Service]\n" +
            "Environment=\"BUCKET=" + bucket.bucketName + "\"\n" +
            "Environment=\"DUCK_DNS_DOMAIN=" + duckDnsSubDomain.valueAsString + "\"\n" +
            "Environment=\"FORGE_VERSION=" + forgeVersion.valueAsString + "\"\n",),
          InitCommand.shellCommand("amazon-linux-extras install java-openjdk11 -y"),
          InitCommand.shellCommand("sudo systemctl daemon-reload"),
        ]),
        installForge: new ec2.InitConfig([
          InitCommand.shellCommand("java -jar /home/ec2-user/forge-installer.jar --installServer /home/ec2-user")
        ]),
        chown: new ec2.InitConfig([
          InitCommand.shellCommand("chown -R ec2-user:ec2-user /home/ec2-user"),
          InitCommand.shellCommand("chmod +x /home/ec2-user/scripts/*.sh"),
        ]),
        enableService: new ec2.InitConfig([
          InitService.enable("minecraft.service", {ensureRunning: true}),
        ])
      }
    });

    const autoScalingGroup = new AutoScalingGroup(this, "asg", {
      machineImage: new AmazonLinuxImage({generation: AmazonLinuxGeneration.AMAZON_LINUX_2}),
      instanceType: InstanceType.of(InstanceClass.T3A, InstanceSize.SMALL),
      vpc: vpc,
      minCapacity: 0,
      desiredCapacity: 0,
      maxCapacity: 1,
      securityGroup: securityGroup,
      role: role,
      init: cloudFormationInit,
      signals: Signals.waitForAll()
    });

    const startServerLambda = new Function(this, "mc-start-server", {
      handler: "startServer.handler",
      runtime: Runtime.NODEJS_12_X,
      code: Code.fromAsset("src"),
      environment: {
        BUCKET: bucket.bucketName,
        DUCK_DNS_DOMAIN: duckDnsSubDomain.valueAsString,
        ASG: autoScalingGroup.autoScalingGroupArn
      }
    })
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

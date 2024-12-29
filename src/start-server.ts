import {
  type AutoScalingClient,
  DescribeAutoScalingGroupsCommand,
  SetDesiredCapacityCommand,
} from "@aws-sdk/client-auto-scaling";
import { DescribeInstancesCommand, type EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeServicesCommand,
  type ECSClient,
  UpdateServiceCommand,
} from "@aws-sdk/client-ecs";
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

interface Props {
  bucket: string;
  duckDnsDomain: string;
  asgName: string;
  clusterArn: string;
  serviceArn: string;
}

export class StartServer {
  constructor(
    private readonly autoScaling: AutoScalingClient,
    private readonly ecs: ECSClient,
    private readonly s3: S3Client,
    private readonly ec2: EC2Client,
    private readonly props: Props,
  ) {}

  public handler = async () => {
    try {
      await this.scaleAsg();
      await this.startEcsTask();
      const modList = await this.listMods();
      const ec2State = await this.getEc2State();
      const serviceState = await this.getServiceState();

      const body = `
      Server address: ${this.props.duckDnsDomain}.duckdns.org
      Server IP: ${ec2State.ip}
      Mods used: [${modList}]
      EC2 state: ${ec2State.state} (InService is good)
      MC state: ${serviceState} (Pending: 0, Running: 1 is good and means the server is starting right now, wich can take up to five minutes)
      Refresh this page every 30 seconds until everything works.
      `;

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "text/plain",
        },
        body: body,
      };
    } catch (error) {
      const body = JSON.stringify(error, null, 2);
      return {
        statusCode: 500,
        headers: {},
        body: JSON.stringify(body),
      };
    }
  };

  async scaleAsg() {
    await this.autoScaling.send(
      new SetDesiredCapacityCommand({
        AutoScalingGroupName: this.props.asgName,
        DesiredCapacity: 1,
      }),
    );
  }

  async startEcsTask() {
    await this.ecs.send(
      new UpdateServiceCommand({
        cluster: this.props.clusterArn,
        service: this.props.serviceArn,
        desiredCount: 1,
      }),
    );
  }

  async listMods() {
    const response = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.props.bucket,
        Prefix: "mods",
      }),
    );
    return response.Contents?.map((x) => x.Key)
      .filter((x) => x !== undefined)
      .map((s: string) => s.replace("mods/", ""))
      .filter((s: string) => s !== "")
      .join();
  }

  async getEc2State() {
    const response = await this.autoScaling.send(
      new DescribeAutoScalingGroupsCommand({
        AutoScalingGroupNames: [this.props.asgName],
      }),
    );
    if (
      response.AutoScalingGroups?.[0]?.Instances &&
      response.AutoScalingGroups[0].Instances.length > 0
    ) {
      const ipResponse = await this.ec2.send(
        new DescribeInstancesCommand({
          InstanceIds: [response.AutoScalingGroups[0].Instances[0].InstanceId!],
        }),
      );
      const publicIpAddress =
        ipResponse.Reservations?.[0].Instances?.[0].PublicIpAddress;
      return {
        state: response.AutoScalingGroups[0].Instances[0].LifecycleState,
        ip: publicIpAddress,
      };
    }
    return { stage: "Waiting for EC2 instance...", ip: undefined };
  }

  async getServiceState() {
    const response = await this.ecs.send(
      new DescribeServicesCommand({
        cluster: this.props.clusterArn,
        services: [this.props.serviceArn],
      }),
    );
    const pendingCount = response.services?.[0].pendingCount;
    const runningCount = response.services?.[0].runningCount;
    return `Pending: ${pendingCount}, Running: ${runningCount}`;
  }
}

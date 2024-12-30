import { Console } from "node:console";
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
import {
  GetObjectCommand,
  ListObjectsV2Command,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import type { EmbeddedMetricFormat } from "./embedded-metric-format";

interface Props {
  bucket: string;
  duckDnsDomain: string;
  asgName: string;
  clusterArn: string;
  serviceArn: string;
}

export class StartServer {
  private readonly emf: Console["log"];

  constructor(
    private readonly autoScaling: AutoScalingClient,
    private readonly ecs: ECSClient,
    private readonly s3: S3Client,
    private readonly ec2: EC2Client,
    private readonly props: Props,
  ) {
    this.emf = new Console({ stdout: process.stdout }).log;
  }

  public handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    console.log(JSON.stringify(event));
    const email = event.requestContext.authorizer.jwt.claims.email;

    const cwMetricsLogs: EmbeddedMetricFormat = {
      _aws: {
        Timestamp: event.requestContext.timeEpoch,
        CloudWatchMetrics: [
          {
            Namespace: "Minecraft",
            Dimensions: [["User"]],
            Metrics: [
              {
                Name: "started",
                Unit: "Count",
              },
            ],
          },
        ],
      },
      started: 1,
      User: email,
    };
    this.emf(JSON.stringify(cwMetricsLogs));

    await this.scaleAsg();
    await this.startEcsTask();
    const modList = await this.listMods();
    const ec2State = await this.getEc2State();
    const serviceState = await this.getServiceState();
    const formattedModList = await this.formatMods(modList);

    const body = `
      Server address: ${this.props.duckDnsDomain}.duckdns.org<br />
      Server IP: ${ec2State.ip}<br />
      <br />
      ${formattedModList}
      <br />
      EC2 state: ${ec2State.state} (InService is good)<br />
      MC state: ${serviceState} (Pending: 0, Running: 1 is good and means the server is starting right now, wich can take up to five minutes)<br />
      <br />
      Refresh this page every 30 seconds until everything works.
      `;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html",
        "access-control-allow-origin": "*",
      },
      body: body,
    };
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
        Prefix: "mods/",
      }),
    );
    return response.Contents?.map((x) => x.Key)
      .filter((x) => x !== undefined)
      .map((s: string) => s.replace("mods/", ""))
      .filter((s: string) => s !== "");
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

  private async formatMods(modList: string[] | undefined) {
    if (!modList) {
      return "Error loading mods! Please contact admin";
    }
    const serverMods = modList
      .filter((x) => x.startsWith("server/"))
      .map((x) => x.replace("server/", ""))
      .filter((x) => x !== "");
    const clientMods = modList
      .filter((x) => x.startsWith("client/"))
      .map((x) => x.replace("client/", ""))
      .filter((x) => x !== "");

    let formattedList = "Mods:<br />";
    formattedList = `${formattedList}Client mods (These must be downloaded by you!):<br />`;
    for (const mod of clientMods) {
      const signedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.props.bucket,
          Key: `mods/${mod}`,
        }),
        {
          expiresIn: 60 * 5,
        },
      );
      formattedList = `${formattedList}- ${mod}: <a href="${signedUrl}" download>Download</a><br />`;
    }
    formattedList = `${formattedList}<br />Server mods (just fyi):<br />`;
    for (const mod of serverMods) {
      formattedList = `${formattedList}- ${mod}<br />`;
    }
    return formattedList;
  }
}

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
import type {
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { isMinecraftReady } from "../minecraft-status.ts";

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

  public handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
    event,
  ): Promise<APIGatewayProxyStructuredResultV2> => {
    const method = event.requestContext.http.method;
    if (method !== "GET" && method !== "POST") {
      return {
        statusCode: 405,
        headers: { Allow: "GET, POST", "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Method not allowed" }),
      };
    }
    if (method === "POST") {
      console.log(
        `Starting Minecraft server for user ${event.requestContext.authorizer.jwt.claims.email}...`,
      );
      await this.scaleAsg();
      await this.startEcsTask();
    }
    const modList = await this.listMods();
    const ec2State = await this.getEc2State();
    const serviceState = await this.getServiceState();
    const mods = await this.formatMods(modList);
    const ready =
      serviceState.running > 0 &&
      serviceState.pending === 0 &&
      !!ec2State.ip &&
      (await isMinecraftReady(ec2State.ip));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
      body: JSON.stringify({
        address: `${this.props.duckDnsDomain}.duckdns.org`,
        ip: ec2State.ip ?? null,
        ec2State: ec2State.state,
        serviceState,
        mods,
        ready,
      }),
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
    return (response.Contents ?? [])
      .map((x) => x.Key)
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
    return { state: "Waiting for EC2 instance...", ip: undefined };
  }

  async getServiceState() {
    const response = await this.ecs.send(
      new DescribeServicesCommand({
        cluster: this.props.clusterArn,
        services: [this.props.serviceArn],
      }),
    );
    const service = response.services?.[0];
    if (
      !service ||
      response.failures?.length ||
      typeof service.pendingCount !== "number" ||
      typeof service.runningCount !== "number" ||
      typeof service.desiredCount !== "number" ||
      !Number.isInteger(service.pendingCount) ||
      !Number.isInteger(service.runningCount) ||
      !Number.isInteger(service.desiredCount) ||
      service.pendingCount < 0 ||
      service.runningCount < 0 ||
      service.desiredCount < 0
    ) {
      throw new Error("Unable to load Minecraft service state");
    }
    return {
      desired: service.desiredCount,
      pending: service.pendingCount,
      running: service.runningCount,
    };
  }

  private async formatMods(modList: string[]) {
    const serverMods = modList
      .filter((x) => x.startsWith("server/"))
      .map((x) => x.replace("server/", ""))
      .filter((x) => x !== "");
    const clientMods = modList
      .filter((x) => x.startsWith("client/"))
      .map((x) => x.replace("client/", ""))
      .filter((x) => x !== "");

    const client: { name: string; url: string }[] = [];
    for (const mod of clientMods) {
      const signedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.props.bucket,
          Key: `mods/client/${mod}`,
        }),
        {
          expiresIn: 60 * 5,
        },
      );
      client.push({ name: mod, url: signedUrl });
    }
    return { client, server: serverMods };
  }
}

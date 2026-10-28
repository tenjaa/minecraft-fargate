import { DescribeInstancesCommand, type EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeContainerInstancesCommand,
  DescribeTasksCommand,
  type ECSClient,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { listProfiles } from "./database/entities.ts";
import { loadStrict } from "./env.ts";
import type { AllowlistAction, OpAction } from "./lambdas/rcon.handler.ts";

interface Props {
  rconFunction: string;
  rconPassword: string;
}

async function serverAddress(ecs: ECSClient, ec2: EC2Client) {
  const cluster = loadStrict("MC_CLUSTER");
  const serviceName = loadStrict("MC_SERVICE_NAME");
  const listed = await ecs.send(
    new ListTasksCommand({ cluster, serviceName, desiredStatus: "RUNNING" }),
  );
  if (!listed.taskArns?.length) {
    return undefined;
  }
  if (listed.taskArns.length !== 1 || listed.nextToken) {
    throw new Error("Expected a single Minecraft task");
  }
  const tasks = await ecs.send(
    new DescribeTasksCommand({ cluster, tasks: listed.taskArns }),
  );
  const task = tasks.tasks?.[0];
  if (tasks.failures?.length || !task) {
    throw new Error("Unable to describe Minecraft task");
  }
  if (task.lastStatus !== "RUNNING") {
    return undefined;
  }
  if (!task.containerInstanceArn) {
    throw new Error("Minecraft task has no container instance");
  }
  const containers = await ecs.send(
    new DescribeContainerInstancesCommand({
      cluster,
      containerInstances: [task.containerInstanceArn],
    }),
  );
  const instanceId = containers.containerInstances?.[0]?.ec2InstanceId;
  if (containers.failures?.length || !instanceId) {
    throw new Error("Unable to find Minecraft EC2 instance");
  }
  const instances = await ec2.send(
    new DescribeInstancesCommand({ InstanceIds: [instanceId] }),
  );
  const address = instances.Reservations?.[0]?.Instances?.[0]?.PrivateIpAddress;
  if (!address) {
    throw new Error("Minecraft instance has no private IP");
  }
  return address;
}

export class RconClient {
  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly ecsClient: ECSClient,
    private readonly ec2Client: EC2Client,
    private readonly props: Props,
  ) {}

  private async resolveHost() {
    const host = await serverAddress(this.ecsClient, this.ec2Client);
    if (!host) {
      throw new Error(
        "Minecraft server is offline; allowlist will be applied after startup",
      );
    }

    return host;
  }

  public async sendAllowlistAction() {
    const host = await this.resolveHost();
    const profiles = await listProfiles();
    console.log(`Found ${profiles.length} profiles in the database`);
    const usernames = profiles.map((profile) => profile.minecraftName);
    const uniqueUsers = [...new Set(usernames)];
    const request: AllowlistAction = {
      action: "allowlist",
      host,
      password: this.props.rconPassword,
      usernames: uniqueUsers,
    };
    const result = await this.lambdaClient.send(
      new InvokeCommand({
        FunctionName: this.props.rconFunction,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(request)),
      }),
    );
    if (result.FunctionError || result.StatusCode !== 200 || !result.Payload) {
      throw new Error(
        "Allowlist RCON executor failed; see its CloudWatch logs",
      );
    }
    console.log("Allowlist RCON executed successfully");
  }

  public async sendOpAction(op: string) {
    const host = await this.resolveHost();
    const opRequest: OpAction = {
      action: "op",
      host,
      password: this.props.rconPassword,
      username: op,
    };
    console.log(`Op: ${opRequest.username}`);

    const opResult = await this.lambdaClient.send(
      new InvokeCommand({
        FunctionName: this.props.rconFunction,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify(opRequest)),
      }),
    );
    if (
      opResult.FunctionError ||
      opResult.StatusCode !== 200 ||
      !opResult.Payload
    ) {
      throw new Error("Op RCON executor failed; see its CloudWatch logs");
    }
    console.log("Op RCON executed successfully");
  }
}

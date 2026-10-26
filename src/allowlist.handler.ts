import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeContainerInstancesCommand,
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { allowlistSnapshot } from "./allowlist.ts";
import { loadStrict } from "./env.ts";
import {
  acknowledgeSynchronization,
  failSynchronization,
  pendingSynchronization,
} from "./profiles.ts";

const ecs = new ECSClient();
const ec2 = new EC2Client();
const lambda = new LambdaClient();
const ssm = new SSMClient();
const cluster = loadStrict("MC_CLUSTER");
const serviceName = loadStrict("MC_SERVICE_NAME");
const rconFunction = loadStrict("RCON_FUNCTION");
const rconPasswordParameter = loadStrict("RCON_PASSWORD_PARAMETER");

async function serverAddress() {
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

// Scheduled outside the VPC so AWS APIs and Mojang need no NAT or endpoints.
export async function handler() {
  try {
    const host = await serverAddress();
    if (!host) {
      await pendingSynchronization();
      return { status: "pending" };
    }
    const [snapshot, parameter] = await Promise.all([
      allowlistSnapshot(),
      ssm.send(
        new GetParameterCommand({
          Name: rconPasswordParameter,
          WithDecryption: true,
        }),
      ),
    ]);
    const password = parameter.Parameter?.Value;
    if (!password || !/^[A-Za-z0-9]{48}$/.test(password)) {
      throw new Error(
        "RCON password parameter must contain 48 alphanumeric characters",
      );
    }
    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: rconFunction,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(JSON.stringify({ ...snapshot, host, password })),
      }),
    );
    if (result.FunctionError || result.StatusCode !== 200 || !result.Payload) {
      throw new Error("RCON executor failed; see its CloudWatch logs");
    }
    const confirmation: unknown = JSON.parse(
      Buffer.from(result.Payload).toString("utf8"),
    );
    if (
      !confirmation ||
      typeof confirmation !== "object" ||
      !("status" in confirmation) ||
      confirmation.status !== "applied" ||
      !("revision" in confirmation) ||
      confirmation.revision !== snapshot.revision
    ) {
      throw new Error("Invalid RCON synchronization confirmation");
    }
    await acknowledgeSynchronization(snapshot.revision);
    return { status: "applied" };
  } catch (error) {
    console.error("Allowlist synchronization failed", error);
    await failSynchronization();
    throw error;
  }
}

import { DescribeInstancesCommand, EC2Client } from "@aws-sdk/client-ec2";
import {
  DescribeContainerInstancesCommand,
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { loadStrict } from "../env.ts";
import { Allowlist } from "./allowlist.ts";

const ecs = new ECSClient();
const ec2 = new EC2Client();
const ssm = new SSMClient();
const cluster = loadStrict("MC_CLUSTER");
const serviceName = loadStrict("MC_SERVICE_NAME");
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

const host = await serverAddress();
if (!host) {
  throw new Error("Minecraft server is not running");
}

const rconPasswordReponse = await ssm.send(
  new GetParameterCommand({
    Name: rconPasswordParameter,
    WithDecryption: true,
  }),
);
if (!rconPasswordReponse.Parameter?.Value) {
  throw new Error("RCON password not found");
}

export const handler = new Allowlist(new LambdaClient(), {
  host: host,
  opUsername: loadStrict("OP_USERNAME"),
  rconFunction: loadStrict("RCON_FUNCTION"),
  rconPassword: rconPasswordReponse.Parameter.Value,
}).handler;

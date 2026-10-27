import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import { loadStrict } from "../env.ts";
import { initRconProps, RconClient } from "../rcon-client.ts";
import { Allowlist } from "./allowlist.ts";

const lambdaClient = new LambdaClient();
const ssmClient = new SSMClient();
const ecsClient = new ECSClient();
const ec2Client = new EC2Client();
const rconClient = new RconClient(
  lambdaClient,
  await initRconProps(ssmClient, ecsClient, ec2Client),
);

export const handler = new Allowlist(rconClient, {
  opUsername: loadStrict("OP_USERNAME"),
}).handler;

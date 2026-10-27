import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import { loadStrict } from "../env.ts";
import { initRconProps, RconClient } from "../rcon-client.ts";
import { Allowlist } from "./allowlist.ts";

console.log("Allowlist handler loaded");
const lambdaClient = new LambdaClient();
const ssmClient = new SSMClient();
const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

console.log("Created clients");

const props = await initRconProps(ssmClient, ecsClient, ec2Client);
if (!props) {
  throw new Error(
    "Minecraft server is offline; allowlist will be applied after startup",
  );
}
const rconClient = new RconClient(lambdaClient, props);

export const handler = new Allowlist(rconClient, {
  opUsername: loadStrict("OP_USERNAME"),
}).handler;

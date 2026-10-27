import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import type { Handler } from "aws-lambda";
import { loadStrict } from "../env.ts";
import { initRconProps, RconClient } from "../rcon-client.ts";
import { Allowlist } from "./allowlist.ts";

const lambdaClient = new LambdaClient();
const ssmClient = new SSMClient();
const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

export const handler: Handler = async (event, context, callback) => {
  const props = await initRconProps(ssmClient, ecsClient, ec2Client);
  if (!props) {
    console.log(
      "Minecraft server is offline; allowlist will be applied after startup",
    );
    return;
  }
  const rconClient = new RconClient(lambdaClient, props);
  return new Allowlist(rconClient, {
    opUsername: loadStrict("OP_USERNAME"),
  }).handler(event, context, callback);
};

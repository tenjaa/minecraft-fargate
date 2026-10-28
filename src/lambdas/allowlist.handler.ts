import { EC2Client } from "@aws-sdk/client-ec2";
import { ECSClient } from "@aws-sdk/client-ecs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { loadStrict } from "../env.ts";
import { RconClient } from "../rcon-client.ts";
import { Allowlist } from "./allowlist.ts";

console.log("Allowlist handler loaded");
const lambdaClient = new LambdaClient();
const ssmClient = new SSMClient();
const ecsClient = new ECSClient();
const ec2Client = new EC2Client();

console.log("Created clients");

const rconPasswordResponse = await ssmClient.send(
  new GetParameterCommand({
    Name: loadStrict("RCON_PASSWORD_PARAMETER"),
    WithDecryption: true,
  }),
);
if (!rconPasswordResponse.Parameter?.Value) {
  throw new Error("RCON password not found");
}

const rconClient = new RconClient(lambdaClient, ecsClient, ec2Client, {
  rconFunction: loadStrict("RCON_FUNCTION"),
  rconPassword: rconPasswordResponse.Parameter.Value,
});

export const handler = new Allowlist(rconClient, {
  opUsername: loadStrict("OP_USERNAME"),
}).handler;

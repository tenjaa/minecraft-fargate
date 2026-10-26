import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { Handler } from "aws-lambda";
import { listProfiles } from "../database/entities.ts";
import { resolveMinecraftProfile } from "../minecraft-api.ts";
import type { AllowlistAction, OpAction } from "./rcon.handler.ts";

interface Props {
  opUsername: string;
  rconFunction: string;
  rconPassword: string;
  host: string;
}

export class Allowlist {
  constructor(
    private readonly lambdaClient: LambdaClient,
    private readonly props: Props,
  ) {}

  public handler: Handler = async () => {
    const profiles = await listProfiles();
    console.log(`Found ${profiles.length} profiles in the database`);
    const operator = await resolveMinecraftProfile(this.props.opUsername);
    if (!operator) {
      throw new Error("Configured Minecraft operator was not found");
    }
    const request: AllowlistAction = {
      action: "allowlist",
      host: this.props.host,
      password: this.props.rconPassword,
      usernames: profiles.map((profile) => profile.minecraftName),
    };
    console.log(`Allowlist: ${request.usernames.join(", ")}`);

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

    const opRequest: OpAction = {
      action: "op",
      host: this.props.host,
      password: this.props.rconPassword,
      username: operator.name,
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
  };
}

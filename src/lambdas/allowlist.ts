import type { Handler } from "aws-lambda";
import { resolveMinecraftProfile } from "../minecraft-api.ts";
import type { RconClient } from "../rcon-client.ts";

interface Props {
  opUsername: string;
}

export class Allowlist {
  constructor(
    private readonly rconClient: RconClient,
    private readonly props: Props,
  ) {}

  public handler: Handler = async () => {
    await this.rconClient.sendAllowlistAction();

    const operator = await resolveMinecraftProfile(this.props.opUsername);
    if (!operator) {
      throw new Error("Configured Minecraft operator was not found");
    }
    await this.rconClient.sendOpAction(operator.name);
  };
}

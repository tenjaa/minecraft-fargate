import { Rcon } from "rcon-client";
import { z } from "zod";

const rconBaseAction = z.object({
  host: z.string(),
  password: z.string(),
});

const allowlistAction = rconBaseAction.extend({
  action: z.literal("allowlist"),
  usernames: z.array(z.string()),
});
export type AllowlistAction = z.infer<typeof allowlistAction>;
const opAction = rconBaseAction.extend({
  action: z.literal("op"),
  username: z.string(),
});
export type OpAction = z.infer<typeof opAction>;
const rconAction = z.discriminatedUnion("action", [allowlistAction, opAction]);

async function command(client: Rcon, text: string, expected: string[]) {
  const response = (await client.send(text)).trim();
  if (!expected.includes(response)) {
    throw new Error(`Minecraft rejected ${text}: ${response}`);
  }
}

async function readWhitelist(client: Rcon) {
  const response = (await client.send("whitelist list")).trim();
  if (response === "There are no whitelisted players") {
    return [];
  }
  const match = /^There are (\d+) whitelisted player(?:\(s\)|s?):\s*(.*)$/.exec(
    response,
  );
  const names = match?.[2] ? match[2].split(/,\s*/) : [];
  if (
    !match ||
    Number(match[1]) !== names.length ||
    new Set(names.map((name) => name.toLowerCase())).size !== names.length
  ) {
    throw new Error("Unable to read Minecraft whitelist response");
  }
  return names;
}

// No AWS API calls here: the coordinator supplies the private IP and secret.
export async function handler(event: unknown) {
  const parsedEvent = rconAction.parse(event);

  switch (parsedEvent.action) {
    case "allowlist":
      console.log(
        `Synchronizing Minecraft whitelist for ${parsedEvent.usernames.length} users`,
      );
      return await handleAllowlist(parsedEvent);
    case "op":
      console.log(
        `Synchronizing Minecraft operator for ${parsedEvent.username}`,
      );
      return await handleOp(parsedEvent);
    default:
      console.log(`Unknown RCON action: ${JSON.stringify(parsedEvent)}`);
      throw new Error(`Unknown RCON action!`);
  }
}

async function handleAllowlist(event: z.infer<typeof allowlistAction>) {
  const client = new Rcon({
    host: event.host,
    port: 25575,
    password: event.password,
    timeout: 3000,
  });
  client.on("error", (error: Error) => {
    console.error("RCON socket error", error.message);
  });
  const deadline = setTimeout(() => {
    client.socket?.destroy(new Error("RCON synchronization deadline exceeded"));
  }, 25000);
  try {
    await client.connect();
    await command(client, "whitelist on", [
      "Whitelist is already turned on",
      "Whitelist is now turned on",
    ]);
    const desired = new Map(
      event.usernames.map((username) => [username.toLowerCase(), username]),
    );
    const current = await readWhitelist(client);
    for (const name of current) {
      if (!desired.has(name.toLowerCase())) {
        await command(client, `deop ${name}`, [
          `Made ${name} no longer a server operator`,
          "Nothing changed. The player is not an operator",
        ]);
        await command(client, `whitelist remove ${name}`, [
          `Removed ${name} from the whitelist`,
        ]);
      }
    }
    const existing = new Set(current.map((name) => name.toLowerCase()));
    for (const [normalized, name] of desired) {
      if (!existing.has(normalized)) {
        await command(client, `whitelist add ${name}`, [
          `Added ${name} to the whitelist`,
        ]);
      }
    }
    await command(client, "whitelist reload", ["Reloaded the whitelist"]);
    const actual = await readWhitelist(client);
    if (
      actual.length !== desired.size ||
      !actual.every((name) => desired.has(name.toLowerCase()))
    ) {
      throw new Error(
        "Minecraft whitelist does not match the desired accounts",
      );
    }
  } catch (error) {
    console.error(
      "RCON synchronization failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  } finally {
    clearTimeout(deadline);
    client.socket?.destroy();
  }
}

async function handleOp(event: z.infer<typeof opAction>) {
  const client = new Rcon({
    host: event.host,
    port: 25575,
    password: event.password,
    timeout: 3000,
  });
  client.on("error", (error: Error) => {
    console.error("RCON socket error", error.message);
  });
  const deadline = setTimeout(() => {
    client.socket?.destroy(new Error("RCON synchronization deadline exceeded"));
  }, 25000);
  try {
    await client.connect();

    await command(client, `op ${event.username}`, [
      `Made ${event.username} a server operator`,
      "Nothing changed. The player already is an operator",
    ]);
  } catch (error) {
    console.error(
      "RCON synchronization failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    throw error;
  } finally {
    clearTimeout(deadline);
    client.socket?.destroy();
  }
}

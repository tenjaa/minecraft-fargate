import { isIPv4 } from "node:net";
import { Rcon } from "rcon-client";
import { type MinecraftProfile, minecraftName } from "../minecraft-profile.ts";

interface RconRequest {
  host: string;
  password: string;
  revision: string;
  operator: MinecraftProfile;
  whitelist: MinecraftProfile[];
}

function isProfile(value: unknown): value is MinecraftProfile {
  return (
    value !== null &&
    typeof value === "object" &&
    "uuid" in value &&
    typeof value.uuid === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.uuid) &&
    "name" in value &&
    typeof value.name === "string" &&
    minecraftName.test(value.name)
  );
}

function isRequest(value: unknown): value is RconRequest {
  if (
    !(
      value !== null &&
      typeof value === "object" &&
      "host" in value &&
      typeof value.host === "string" &&
      isIPv4(value.host) &&
      "password" in value &&
      typeof value.password === "string" &&
      /^[A-Za-z0-9]{48}$/.test(value.password) &&
      "revision" in value &&
      typeof value.revision === "string" &&
      /^[0-9a-f]{64}$/.test(value.revision) &&
      "operator" in value &&
      isProfile(value.operator) &&
      "whitelist" in value &&
      Array.isArray(value.whitelist) &&
      value.whitelist.length > 0 &&
      value.whitelist.every(isProfile)
    )
  ) {
    return false;
  }
  const { operator, whitelist } = value;
  return (
    new Set(whitelist.map((profile) => profile.uuid)).size ===
      whitelist.length &&
    new Set(whitelist.map((profile) => profile.name.toLowerCase())).size ===
      whitelist.length &&
    whitelist.some(
      (profile) =>
        profile.uuid === operator.uuid && profile.name === operator.name,
    )
  );
}

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
    new Set(names.map((name) => name.toLowerCase())).size !== names.length ||
    !names.every((name) => minecraftName.test(name))
  ) {
    throw new Error("Unable to read Minecraft whitelist response");
  }
  return names;
}

// No AWS API calls here: the coordinator supplies the private IP and secret.
export async function handler(event: unknown) {
  if (!isRequest(event)) {
    throw new Error("Invalid RCON synchronization request");
  }
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
      event.whitelist.map((profile) => [
        profile.name.toLowerCase(),
        profile.name,
      ]),
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
    await command(client, `op ${event.operator.name}`, [
      `Made ${event.operator.name} a server operator`,
      "Nothing changed. The player already is an operator",
    ]);
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
    return { status: "applied", revision: event.revision };
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

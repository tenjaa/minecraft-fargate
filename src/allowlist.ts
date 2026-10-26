import { createHash } from "node:crypto";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";
import { loadStrict } from "./env.ts";
import { type MinecraftProfile, minecraftName } from "./minecraft-profile.ts";
import { getSynchronization, listProfiles } from "./profiles.ts";

const cognito = new CognitoIdentityProviderClient();
const userPoolId = loadStrict("USER_POOL_ID");
const opUsername = loadStrict("OP_USERNAME");
let operator: { profile: MinecraftProfile; expires: number } | undefined;

export class ProfileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function activeUser(username: string, sub: string) {
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
    );
    return (
      user.Enabled === true &&
      user.UserAttributes?.some(
        (attribute) => attribute.Name === "sub" && attribute.Value === sub,
      ) === true
    );
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      return false;
    }
    throw error;
  }
}

export async function resolveMinecraftProfile(
  username: string,
): Promise<MinecraftProfile> {
  if (!minecraftName.test(username)) {
    throw new ProfileError(400, "invalid-name");
  }
  const response = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    { signal: AbortSignal.timeout(5000), redirect: "error" },
  );
  if (response.status === 204 || response.status === 404) {
    throw new ProfileError(400, "unknown-player");
  }
  if (!response.ok) {
    throw new Error(`Minecraft profile lookup failed: ${response.status}`);
  }
  const value: unknown = await response.json();
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{32}$/i.test(value.id) ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !minecraftName.test(value.name) ||
    value.name.toLowerCase() !== username.toLowerCase()
  ) {
    throw new Error("Invalid Minecraft profile response");
  }
  const id = value.id.toLowerCase();
  return {
    uuid: `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    name: value.name,
  };
}

export async function allowlistSnapshot() {
  if (!operator || operator.expires <= Date.now()) {
    operator = {
      profile: await resolveMinecraftProfile(opUsername),
      expires: Date.now() + 300000,
    };
  }
  const profiles = await listProfiles();
  const entries = new Map<string, MinecraftProfile>();
  // Derive membership instead of keeping a mutable reference count: shared
  // accounts survive removals, including concurrent updates to other users.
  for (const profile of profiles.sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (await activeUser(profile.cognitoUsername, profile.sk)) {
      entries.set(profile.uuid, { uuid: profile.uuid, name: profile.name });
    }
  }
  entries.set(operator.profile.uuid, operator.profile);
  const whitelist = [...entries.values()].sort((a, b) =>
    a.uuid.localeCompare(b.uuid),
  );
  const revision = createHash("sha256")
    .update(JSON.stringify(whitelist))
    .digest("hex");
  return { whitelist, revision, operator: operator.profile };
}

export async function synchronizationStatus() {
  const [snapshot, synchronization] = await Promise.all([
    allowlistSnapshot(),
    getSynchronization(),
  ]);
  const state = synchronization?.failedAt
    ? "failed"
    : synchronization?.revision === snapshot.revision &&
        (synchronization.appliedAt ?? 0) >= Date.now() - 90000
      ? "applied"
      : "pending";
  return { state, appliedAt: synchronization?.appliedAt ?? null };
}

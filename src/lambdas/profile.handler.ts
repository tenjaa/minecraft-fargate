import type {
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  getProfile,
  removeProfile,
  saveProfile,
} from "../database/entities.ts";
import { resolveMinecraftProfile } from "../minecraft-api.ts";

export class ProfileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function response(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function requestedName(body: string | undefined, encoded: boolean) {
  if (!body || body.length > 1024) {
    throw new ProfileError(400, "invalid-name");
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded ? Buffer.from(body, "base64").toString() : body);
  } catch {
    throw new ProfileError(400, "invalid-name");
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    throw new ProfileError(400, "invalid-name");
  }
  return value.name.trim();
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event,
) => {
  try {
    const claims = event.requestContext.authorizer.jwt.claims;
    const sub = claims.sub;
    const username = claims["cognito:username"];
    if (typeof sub !== "string" || typeof username !== "string") {
      throw new ProfileError(403, "expired");
    }
    const method = event.requestContext.http.method;
    if (method === "PUT") {
      const minecraftProfile = await resolveMinecraftProfile(
        requestedName(event.body, event.isBase64Encoded),
      );
      if (!minecraftProfile) {
        throw new ProfileError(400, "unknown-player");
      }
      console.log(
        `Saving Minecraft profile for ${username}: ${minecraftProfile.id} (${minecraftProfile.name})`,
      );
      await saveProfile(sub, minecraftProfile);
      return response(200, {
        profile: minecraftProfile,
      });
    }
    if (method === "DELETE") {
      await removeProfile(sub);
      return response(200, {
        profile: null,
      });
    }
    if (method !== "GET") {
      return response(
        405,
        { code: "method-not-allowed" },
        { Allow: "GET, PUT, DELETE" },
      );
    }
    const profile = await getProfile(sub);

    return response(200, {
      profile: profile
        ? { id: profile.minecraftId, name: profile.minecraftName }
        : null,
    });
  } catch (error) {
    if (error instanceof ProfileError) {
      return response(error.status, { code: error.code });
    }
    console.error("Minecraft profile request failed", error);
    return response(503, { code: "profile-unavailable" });
  }
};

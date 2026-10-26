export const FIRST_STEP_MESSAGE =
  "Falls deine Adresse freigeschaltet ist, erhaeltst du einen Code. Pruefe dein E-Mail-Postfach.";

export class SafeError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

function awsUrl(value, hostPattern) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hostPattern.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function validToken(token) {
  return (
    typeof token === "string" &&
    token.length <= 20000 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  );
}

export function scrubFragment(win) {
  if (win.location.hash) {
    win.history.replaceState(
      null,
      "",
      win.location.pathname + win.location.search,
    );
  }
}

export async function cognito(config, action, payload, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(config.cognitoEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new SafeError("network");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new SafeError(response.status >= 500 ? "network" : "auth");
  }
  if (!response.ok) {
    const type =
      typeof result?.__type === "string" ? result.__type.split("#").pop() : "";
    if (type === "CodeMismatchException") {
      throw new SafeError("code");
    }
    if (type === "ExpiredCodeException" || type === "NotAuthorizedException") {
      throw new SafeError("expired");
    }
    if (response.status >= 500) {
      throw new SafeError("network");
    }
    throw new SafeError("auth");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new SafeError("auth");
  }
  return result;
}

export function safeDownloadUrl(value) {
  if (
    !awsUrl(
      value,
      /^(?:[a-z0-9.-]+\.s3(?:[.-][a-z0-9-]+)*|s3(?:[.-][a-z0-9-]+)*)\.amazonaws\.com(?:\.cn)?$/,
    )
  ) {
    return undefined;
  }
  return new URL(value).href;
}

const text = (value, limit = 1024) =>
  typeof value === "string" && value.length > 0 && value.length <= limit;
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function validateServer(value) {
  if (
    !value ||
    !text(value.address) ||
    !(value.ip === null || text(value.ip)) ||
    !text(value.ec2State, 100) ||
    !value.serviceState ||
    !count(value.serviceState.pending) ||
    !count(value.serviceState.running) ||
    !count(value.serviceState.desired) ||
    typeof value.ready !== "boolean" ||
    !value.mods ||
    !Array.isArray(value.mods.client) ||
    !Array.isArray(value.mods.server) ||
    value.mods.client.length > 1000 ||
    value.mods.server.length > 1000 ||
    !value.mods.client.every(
      (mod) =>
        mod &&
        text(mod.name) &&
        text(mod.url, 20000) &&
        safeDownloadUrl(mod.url),
    ) ||
    !value.mods.server.every((name) => text(name))
  ) {
    throw new SafeError("response");
  }
  return value;
}

export async function fetchServer(
  config,
  token,
  fetcher = fetch,
  method = "GET",
) {
  return fetchAuthenticated(
    config.apiUrl,
    token,
    fetcher,
    method,
    validateServer,
  );
}

export function validateProfile(value) {
  if (
    !value ||
    !(
      value.profile === null ||
      (value.profile &&
        typeof value.profile.name === "string" &&
        /^[A-Za-z0-9_]{3,16}$/.test(value.profile.name) &&
        typeof value.profile.uuid === "string" &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(
          value.profile.uuid,
        ))
    ) ||
    !value.synchronization ||
    !["pending", "applied", "failed"].includes(value.synchronization.state) ||
    !(
      value.synchronization.appliedAt === null ||
      count(value.synchronization.appliedAt)
    )
  ) {
    throw new SafeError("response");
  }
  return value;
}

export async function fetchProfile(
  config,
  token,
  fetcher = fetch,
  method = "GET",
  payload,
) {
  return fetchAuthenticated(
    new URL("profile", config.apiUrl).href,
    token,
    fetcher,
    method,
    validateProfile,
    payload,
  );
}

async function fetchAuthenticated(
  url,
  token,
  fetcher,
  method,
  validate,
  payload,
) {
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new SafeError("network");
  }
  if (response.status === 400) {
    let error;
    try {
      error = await response.json();
    } catch {
      throw new SafeError("response");
    }
    throw new SafeError(
      ["invalid-name", "unknown-player"].includes(error?.code)
        ? error.code
        : "response",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new SafeError("expired");
  }
  if (!response.ok) {
    throw new SafeError("server");
  }
  try {
    return validate(await response.json());
  } catch {
    throw new SafeError("response");
  }
}
export const SITE_CONFIG = Object.freeze({
  clientId: "1s107p5c5dippndqvu6fujli0o",
  cognitoEndpoint: "https://cognito-idp.eu-central-1.amazonaws.com/",
  apiUrl: "https://t2qsp41x91.execute-api.eu-central-1.amazonaws.com/",
});

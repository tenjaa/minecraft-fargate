import {
  cognito,
  SITE_CONFIG as config,
  fetchServer,
  SafeError,
  validToken,
} from "./site.mjs";

export const SESSION_KEY = "minecraft.session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN = 60 * 1000;

function validRefreshToken(token) {
  return (
    typeof token === "string" &&
    token.length >= 20 &&
    token.length <= 20000 &&
    /^[A-Za-z0-9_+=/.-]+$/.test(token)
  );
}

function authenticationSession(result, refreshToken, refreshExpiresAt) {
  if (
    !result ||
    !validToken(result.IdToken) ||
    !validRefreshToken(result.RefreshToken ?? refreshToken) ||
    !Number.isSafeInteger(result.ExpiresIn) ||
    result.ExpiresIn <= 0 ||
    !Number.isSafeInteger(Date.now() + result.ExpiresIn * 1000)
  ) {
    throw new SafeError("auth");
  }
  return {
    idToken: result.IdToken,
    refreshToken: result.RefreshToken ?? refreshToken,
    expiresAt: Math.min(Date.now() + result.ExpiresIn * 1000, refreshExpiresAt),
    refreshExpiresAt,
  };
}

function store(storage, session) {
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    throw new SafeError("storage");
  }
}

function remove(storage) {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    throw new SafeError("storage");
  }
}

function load(storage) {
  let raw;
  try {
    raw = storage.getItem(SESSION_KEY);
  } catch {
    throw new SafeError("storage");
  }
  if (raw === null) {
    return undefined;
  }
  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    // Malformed session data is treated like an expired login.
  }
  const now = Date.now();
  if (
    !session ||
    !validToken(session.idToken) ||
    !validRefreshToken(session.refreshToken) ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= 0 ||
    !Number.isSafeInteger(session.refreshExpiresAt) ||
    session.expiresAt > session.refreshExpiresAt ||
    session.refreshExpiresAt <= now ||
    session.refreshExpiresAt > now + SESSION_DURATION
  ) {
    remove(storage);
    return undefined;
  }
  return session;
}

export function saveLogin(authenticationResult, storage) {
  const session = authenticationSession(
    authenticationResult,
    undefined,
    Date.now() + SESSION_DURATION,
  );
  store(storage, session);
}

export function createAuth(storage, fetcher = fetch) {
  let session = load(storage);
  let generation = 0;
  let refreshing;

  function suspend() {
    generation += 1;
    session = undefined;
    refreshing = undefined;
  }

  function clear() {
    suspend();
    remove(storage);
  }

  function restore() {
    suspend();
    session = load(storage);
  }

  function hasSession() {
    if (session && session.refreshExpiresAt <= Date.now()) {
      clear();
    }
    return Boolean(session);
  }

  function assertActive(expectedGeneration) {
    if (generation !== expectedGeneration || !session) {
      throw new SafeError("expired");
    }
    if (!hasSession()) {
      throw new SafeError("expired");
    }
  }

  function refresh(expectedGeneration, rejectedToken) {
    assertActive(expectedGeneration);
    if (refreshing) {
      return refreshing;
    }
    // Another request may already have replaced the token rejected by the API.
    if (rejectedToken && session.idToken !== rejectedToken) {
      return Promise.resolve();
    }
    const current = session;
    const pending = (async () => {
      try {
        const response = await cognito(
          config,
          "InitiateAuth",
          {
            ClientId: config.clientId,
            AuthFlow: "REFRESH_TOKEN_AUTH",
            AuthParameters: { REFRESH_TOKEN: current.refreshToken },
          },
          fetcher,
        );
        assertActive(expectedGeneration);
        const next = authenticationSession(
          response.AuthenticationResult,
          current.refreshToken,
          current.refreshExpiresAt,
        );
        store(storage, next);
        session = next;
      } catch (error) {
        if (generation !== expectedGeneration) {
          throw new SafeError("expired");
        }
        if (error.kind === "network" || error.kind === "storage") {
          throw error;
        }
        clear();
        throw new SafeError("expired");
      } finally {
        if (refreshing === pending) {
          refreshing = undefined;
        }
      }
    })();
    refreshing = pending;
    return pending;
  }

  async function request(method = "GET") {
    const expectedGeneration = generation;
    assertActive(expectedGeneration);
    if (session.expiresAt <= Date.now() + REFRESH_MARGIN) {
      await refresh(expectedGeneration);
    }
    assertActive(expectedGeneration);
    const token = session.idToken;
    try {
      const result = await fetchServer(config, token, fetcher, method);
      assertActive(expectedGeneration);
      return result;
    } catch (error) {
      assertActive(expectedGeneration);
      if (error.kind !== "expired") {
        throw error;
      }
    }
    await refresh(expectedGeneration, token);
    assertActive(expectedGeneration);
    try {
      const result = await fetchServer(
        config,
        session.idToken,
        fetcher,
        method,
      );
      assertActive(expectedGeneration);
      return result;
    } catch (error) {
      assertActive(expectedGeneration);
      if (error.kind === "expired") {
        clear();
        throw new SafeError("expired");
      }
      throw error;
    }
  }

  return { hasSession, request, clear, suspend, restore };
}

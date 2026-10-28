import { createAuth, saveLogin } from "./auth.mjs";
import {
  cognito,
  SITE_CONFIG as config,
  FIRST_STEP_MESSAGE,
  SafeError,
} from "./site.mjs";

export function startLogin(doc = document, win = window, fetcher = fetch) {
  const emailForm = doc.getElementById("email-form");
  const codeForm = doc.getElementById("code-form");
  const email = doc.getElementById("email");
  const submittedEmail = doc.getElementById("submitted-email");
  const code = doc.getElementById("code");
  const status = doc.getElementById("status");
  let session;
  let username;
  let busy = false;
  let active = true;
  let generation = 0;
  let auth;
  const storageMessage =
    "Sign-in requires session storage. Allow it in your browser and try again.";

  function setBusy(value) {
    busy = value;
    for (const element of [...emailForm.elements, ...codeForm.elements]) {
      element.disabled = value || !active;
    }
    emailForm.setAttribute("aria-busy", String(value));
    codeForm.setAttribute("aria-busy", String(value));
  }

  function reset(preserveEmail = false) {
    session = undefined;
    username = undefined;
    if (!preserveEmail) {
      emailForm.reset();
    }
    codeForm.reset();
    submittedEmail.textContent = "";
    emailForm.hidden = false;
    codeForm.hidden = true;
  }

  function redirectSavedSession() {
    let hasSession;
    try {
      if (auth) {
        auth.restore();
      } else {
        auth = createAuth(win.sessionStorage, fetcher);
      }
      hasSession = auth.hasSession();
    } catch {
      status.textContent = storageMessage;
      return;
    }
    if (!hasSession) {
      return;
    }
    generation += 1;
    active = false;
    session = undefined;
    username = undefined;
    setBusy(false);
    status.textContent = "Signed in. Opening your world...";
    win.location.replace("callback.html");
  }

  function finish(result) {
    if (!active) {
      return;
    }
    let storage;
    try {
      storage = win.sessionStorage;
    } catch {
      throw new SafeError("storage");
    }
    saveLogin(result.AuthenticationResult, storage);
    win.location.replace("callback.html");
    session = undefined;
    username = undefined;
    codeForm.reset();
    status.textContent = "Signed in. Opening your world...";
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !active) {
      return;
    }
    const requestGeneration = generation;
    setBusy(true);
    session = undefined;
    username = email.value.trim();
    status.textContent = "Requesting your code...";
    try {
      let result = await cognito(
        config,
        "InitiateAuth",
        {
          ClientId: config.clientId,
          AuthFlow: "USER_AUTH",
          AuthParameters: {
            USERNAME: username,
            PREFERRED_CHALLENGE: "EMAIL_OTP",
          },
        },
        fetcher,
      );
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (result.ChallengeName === "SELECT_CHALLENGE") {
        if (
          !result.AvailableChallenges?.includes("EMAIL_OTP") ||
          typeof result.Session !== "string"
        ) {
          throw new SafeError("auth");
        }
        result = await cognito(
          config,
          "RespondToAuthChallenge",
          {
            ClientId: config.clientId,
            ChallengeName: "SELECT_CHALLENGE",
            Session: result.Session,
            ChallengeResponses: { USERNAME: username, ANSWER: "EMAIL_OTP" },
          },
          fetcher,
        );
      }
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (result.AuthenticationResult) {
        finish(result);
        return;
      }
      if (
        result.ChallengeName !== "EMAIL_OTP" ||
        typeof result.Session !== "string" ||
        !result.Session
      ) {
        throw new SafeError("auth");
      }
      session = result.Session;
    } catch (error) {
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (error.kind === "network" || error.kind === "storage") {
        status.textContent =
          error.kind === "network"
            ? "Connection failed. Check your network and try again."
            : storageMessage;
        return;
      }
    } finally {
      if (requestGeneration === generation) {
        setBusy(false);
      }
    }
    if (!active || requestGeneration !== generation) {
      return;
    }
    submittedEmail.textContent = username;
    emailForm.hidden = true;
    codeForm.hidden = false;
    status.textContent = FIRST_STEP_MESSAGE;
    code.focus();
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !active) {
      return;
    }
    const requestGeneration = generation;
    setBusy(true);
    status.textContent = "Checking your code...";
    try {
      if (!session) {
        throw new SafeError("code");
      }
      const result = await cognito(
        config,
        "RespondToAuthChallenge",
        {
          ClientId: config.clientId,
          ChallengeName: "EMAIL_OTP",
          Session: session,
          ChallengeResponses: {
            USERNAME: username,
            EMAIL_OTP_CODE: code.value.trim(),
          },
        },
        fetcher,
      );
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (typeof result.Session === "string") {
        session = result.Session;
      }
      finish(result);
    } catch (error) {
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (error.kind === "expired") {
        session = undefined;
        status.textContent =
          "Your code or sign-in has expired. Request a new code.";
      } else if (error.kind === "network") {
        status.textContent =
          "Connection failed. Check your network and enter the code again.";
      } else if (error.kind === "storage") {
        status.textContent = storageMessage;
      } else {
        status.textContent =
          "The code couldn't be verified. Check it or request a new code.";
      }
      code.value = "";
      code.focus();
    } finally {
      if (requestGeneration === generation) {
        setBusy(false);
      }
    }
  });

  doc.getElementById("restart").addEventListener("click", () => {
    if (busy) {
      return;
    }
    reset(true);
    status.textContent = "Request a new sign-in code.";
    email.focus();
  });
  win.addEventListener("pagehide", () => {
    active = false;
    generation += 1;
    auth?.suspend();
    reset();
    setBusy(false);
  });
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      generation += 1;
      active = true;
      setBusy(false);
      status.textContent = "Sign in again to continue.";
      redirectSavedSession();
    }
  });
  setBusy(false);
  status.textContent = "Enter your email to request a sign-in code.";
  redirectSavedSession();
}

if (typeof document !== "undefined") {
  startLogin();
}

import {
  cognito,
  SITE_CONFIG as config,
  FIRST_STEP_MESSAGE,
  handoff,
  SafeError,
} from "./site.mjs";

export function startLogin(doc = document, win = window, fetcher = fetch) {
  const emailForm = doc.getElementById("email-form");
  const codeForm = doc.getElementById("code-form");
  const email = doc.getElementById("email");
  const code = doc.getElementById("code");
  const status = doc.getElementById("status");
  let session;
  let username;
  let busy = false;
  let active = true;
  let generation = 0;

  function setBusy(value) {
    busy = value;
    for (const element of [...emailForm.elements, ...codeForm.elements]) {
      element.disabled = value || !active;
    }
    emailForm.setAttribute("aria-busy", String(value));
    codeForm.setAttribute("aria-busy", String(value));
  }

  function reset() {
    session = undefined;
    username = undefined;
    emailForm.reset();
    codeForm.reset();
    emailForm.hidden = false;
    codeForm.hidden = true;
  }

  function finish(result) {
    if (!active) return;
    handoff(
      result.AuthenticationResult?.IdToken,
      win.sessionStorage,
      win.location,
    );
    session = undefined;
    username = undefined;
    codeForm.reset();
    status.textContent = "Angemeldet. Deine Welt wird geoeffnet ...";
  }

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !active) return;
    const requestGeneration = generation;
    setBusy(true);
    session = undefined;
    username = email.value.trim();
    status.textContent = "Code wird angefordert ...";
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
      if (!active || requestGeneration !== generation) return;
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
      if (!active || requestGeneration !== generation) return;
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
      if (!active || requestGeneration !== generation) return;
      if (error.kind === "network" || error.kind === "storage") {
        status.textContent =
          error.kind === "network"
            ? "Verbindung fehlgeschlagen. Bitte pruefe dein Netzwerk und versuche es erneut."
            : "Der sichere Seitenwechsel ist nicht moeglich. Bitte erlaube Sitzungsspeicher in diesem Browser.";
        return;
      }
    } finally {
      if (requestGeneration === generation) setBusy(false);
    }
    if (!active || requestGeneration !== generation) return;
    emailForm.hidden = true;
    codeForm.hidden = false;
    status.textContent = FIRST_STEP_MESSAGE;
    code.focus();
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !active) return;
    const requestGeneration = generation;
    setBusy(true);
    status.textContent = "Code wird geprueft ...";
    try {
      if (!session) throw new SafeError("code");
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
      if (!active || requestGeneration !== generation) return;
      if (typeof result.Session === "string") session = result.Session;
      finish(result);
    } catch (error) {
      if (!active || requestGeneration !== generation) return;
      if (error.kind === "expired") {
        session = undefined;
        status.textContent =
          "Der Code oder die Anmeldung ist abgelaufen. Bitte fordere einen neuen Code an.";
      } else if (error.kind === "network") {
        status.textContent =
          "Verbindung fehlgeschlagen. Bitte pruefe dein Netzwerk und versuche den Code erneut.";
      } else if (error.kind === "storage") {
        status.textContent =
          "Der sichere Seitenwechsel ist nicht moeglich. Bitte erlaube Sitzungsspeicher in diesem Browser.";
      } else {
        status.textContent =
          "Der Code konnte nicht bestaetigt werden. Pruefe ihn oder fordere einen neuen Code an.";
      }
      code.value = "";
      code.focus();
    } finally {
      if (requestGeneration === generation) setBusy(false);
    }
  });

  doc.getElementById("restart").addEventListener("click", () => {
    if (busy) return;
    reset();
    status.textContent = "Fordere einen neuen Code an.";
    email.focus();
  });
  win.addEventListener("pagehide", () => {
    active = false;
    generation += 1;
    reset();
    setBusy(false);
  });
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      active = true;
      setBusy(false);
      status.textContent = "Bitte melde dich erneut an.";
    }
  });
  setBusy(false);
  status.textContent = "Fordere deinen Login-Code an.";
}

if (typeof document !== "undefined") startLogin();

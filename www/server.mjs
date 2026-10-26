import { createAuth } from "./auth.mjs";
import { SafeError, safeDownloadUrl, scrubFragment } from "./site.mjs";

export function renderServer(doc, value) {
  for (const [id, content] of [
    ["address", value.address],
    ["ip", value.ip ?? "Wird noch zugewiesen"],
    ["ec2-state", value.ec2State],
    [
      "service-state",
      `${value.serviceState.running} aktiv · ${value.serviceState.pending} im Start`,
    ],
  ]) {
    doc.getElementById(id).textContent = content;
  }
  const clients = doc.getElementById("client-mods");
  const servers = doc.getElementById("server-mods");
  clients.replaceChildren();
  servers.replaceChildren();
  for (const mod of value.mods.client) {
    const item = doc.createElement("li");
    const link = doc.createElement("a");
    const url = safeDownloadUrl(mod.url);
    if (!url) {
      continue;
    }
    link.href = url;
    link.rel = "noreferrer noopener";
    link.textContent = mod.name;
    item.append(link);
    clients.append(item);
  }
  for (const name of value.mods.server) {
    const item = doc.createElement("li");
    item.textContent = name;
    servers.append(item);
  }
  for (const list of [clients, servers]) {
    if (!list.children.length) {
      const item = doc.createElement("li");
      item.textContent = "Keine Mods erforderlich.";
      list.append(item);
    }
  }
}

export async function startServer(
  doc = document,
  win = window,
  fetcher = fetch,
) {
  scrubFragment(win);
  let auth;
  const status = doc.getElementById("status");
  const refresh = doc.getElementById("refresh");
  const start = doc.getElementById("start");
  const login = doc.getElementById("login-link");
  const details = doc.getElementById("server-details");
  const noticeTitle = doc.getElementById("notice-title");
  const noticeText = doc.getElementById("notice-text");
  const waiting = doc.getElementById("refresh-wait");
  const countdown = doc.getElementById("refresh-countdown");
  const progress = doc.getElementById("refresh-progress");
  const startupWarning = doc.getElementById("startup-warning");
  const copy = doc.getElementById("copy-address");
  const copyStatus = doc.getElementById("copy-status");
  const logout = doc.getElementById("logout");
  let active = true;
  let busy = false;
  let polling = false;
  let canStart = false;
  let pollTimer;
  let countdownTimer;
  let generation = 0;
  let address;
  let startup;
  const startupKey = "minecraft.startup";

  function loadStartup() {
    try {
      const raw = win.sessionStorage.getItem(startupKey);
      startup = raw ? JSON.parse(raw) : undefined;
      if (
        startup &&
        (!Number.isFinite(startup.since) ||
          startup.since < 0 ||
          startup.since > Date.now() ||
          typeof startup.requested !== "boolean")
      ) {
        throw new SafeError("storage");
      }
    } catch {
      throw new SafeError("storage");
    }
  }

  function saveStartup(value) {
    startup = value;
    try {
      if (value) {
        win.sessionStorage.setItem(startupKey, JSON.stringify(value));
      } else {
        win.sessionStorage.removeItem(startupKey);
      }
    } catch {
      throw new SafeError("storage");
    }
  }

  function showStartupWarning() {
    startupWarning.hidden = !(
      polling &&
      startup &&
      Date.now() - startup.since > 300000
    );
  }

  function clearTimers() {
    win.clearTimeout(pollTimer);
    win.clearInterval(countdownTimer);
    waiting.hidden = true;
  }

  function scheduleRefresh() {
    clearTimers();
    if (!active || !polling) {
      return;
    }
    if (!auth?.hasSession()) {
      requireLogin();
      return;
    }
    const nextRefresh = Date.now() + 30000;
    waiting.hidden = false;
    function showCountdown() {
      const seconds = Math.max(0, Math.ceil((nextRefresh - Date.now()) / 1000));
      countdown.textContent = `Wir schauen gleich wieder nach. Naechster Statuscheck in ${seconds} s.`;
      progress.value = 30 - seconds;
      showStartupWarning();
    }
    showCountdown();
    countdownTimer = win.setInterval(showCountdown, 1000);
    pollTimer = win.setTimeout(() => update(), 30000);
  }

  function requireLogin() {
    polling = false;
    clearTimers();
    details.hidden = true;
    refresh.disabled = true;
    start.disabled = true;
    copy.disabled = true;
    startupWarning.hidden = true;
    logout.disabled = !auth?.hasSession();
    login.hidden = false;
    status.textContent =
      "Dein Zugang fehlt oder ist abgelaufen. Bitte melde dich erneut an.";
  }
  async function update(method = "GET") {
    if (!active || busy) {
      return;
    }
    if (!auth?.hasSession()) {
      requireLogin();
      return;
    }
    const requestGeneration = generation;
    clearTimers();
    busy = true;
    refresh.disabled = true;
    start.disabled = true;
    start.textContent =
      method === "POST" ? "Start wird angefordert ..." : "Server starten";
    refresh.textContent = "Wird geladen ...";
    details.setAttribute("aria-busy", "true");
    status.textContent =
      method === "POST"
        ? "Deine Welt wird gestartet ..."
        : "Serverstatus wird abgerufen ...";
    try {
      if (method === "POST") {
        saveStartup({ since: Date.now(), requested: true });
        polling = true;
        canStart = false;
      }
      const value = await auth.request(method);
      if (!active || requestGeneration !== generation) {
        return;
      }
      renderServer(doc, value);
      address = value.address;
      copy.disabled = false;
      details.hidden = false;
      polling = !value.ready && value.serviceState.desired > 0;
      if (polling) {
        if (!startup) {
          saveStartup({ since: Date.now(), requested: false });
        }
      } else {
        saveStartup(undefined);
      }
      showStartupWarning();
      canStart =
        !value.ready &&
        value.serviceState.desired === 0 &&
        value.serviceState.running === 0 &&
        value.serviceState.pending === 0;
      if (value.ready) {
        status.textContent = "Deine Welt ist bereit. Viel Spass beim Bauen!";
        noticeTitle.textContent = "Du kannst dich verbinden";
        noticeText.textContent =
          "Der Minecraft-Server antwortet. Verbinde dich ueber die Server-Adresse. Die automatische Aktualisierung ist beendet.";
      } else if (polling) {
        const starting =
          startup?.requested ||
          value.serviceState.pending > 0 ||
          value.serviceState.running === 0;
        status.textContent = starting
          ? "Deine Welt faehrt hoch. Wir schauen alle 30 Sekunden fuer dich nach."
          : "Der Minecraft-Server antwortet gerade nicht. Wir pruefen den Status alle 30 Sekunden.";
        noticeTitle.textContent = starting
          ? "Ein wenig Geduld"
          : "Warten auf Minecraft";
        noticeText.textContent = starting
          ? "Der Start kann bis zu 5 Minuten dauern. Du kannst in der Zwischenzeit schon die benoetigten Mods herunterladen."
          : "Der Container laeuft, aber Minecraft antwortet noch nicht. Das kann am Start oder an einer Stoerung liegen.";
      } else {
        status.textContent = canStart
          ? "Der Server ist ausgeschaltet. Starte ihn, wenn du spielen moechtest."
          : "Der Server wird heruntergefahren. Aktualisiere den Status spaeter erneut.";
        noticeTitle.textContent = canStart
          ? "Bereit, wenn du es bist"
          : "Die Welt macht eine Pause";
        noticeText.textContent = canStart
          ? "Erst mit einem Klick auf Server starten wird deine Welt hochgefahren."
          : "Sobald der Server ausgeschaltet ist, kannst du ihn wieder starten.";
      }
    } catch (error) {
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (error.kind === "expired") {
        requireLogin();
      } else if (error.kind === "storage") {
        status.textContent =
          "Der Sitzungsspeicher ist nicht verfuegbar. Bitte erlaube ihn im Browser und lade die Seite erneut.";
      } else if (error.kind === "response") {
        status.textContent =
          "Die Serverantwort konnte nicht sicher gelesen werden. Bitte versuche es erneut.";
      } else {
        status.textContent =
          "Der Server ist gerade nicht erreichbar. Bitte pruefe deine Verbindung und versuche es erneut.";
      }
    } finally {
      if (requestGeneration === generation) {
        busy = false;
        refresh.disabled = !active || !auth?.hasSession();
        start.disabled = !active || !auth?.hasSession() || !canStart;
        start.textContent = "Server starten";
        refresh.textContent = "Status aktualisieren";
        details.setAttribute("aria-busy", "false");
        scheduleRefresh();
      }
    }
  }
  refresh.addEventListener("click", () => update());
  start.addEventListener("click", () => {
    if (canStart) {
      return update("POST");
    }
  });
  copy.addEventListener("click", async () => {
    if (!active || !auth?.hasSession() || !address) {
      return;
    }
    const requestGeneration = generation;
    copyStatus.hidden = false;
    copyStatus.textContent = "Adresse wird kopiert ...";
    try {
      if (!win.navigator?.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await win.navigator.clipboard.writeText(address);
      if (!active || requestGeneration !== generation) {
        return;
      }
      copyStatus.textContent = "Server-Adresse kopiert.";
    } catch {
      if (!active || requestGeneration !== generation) {
        return;
      }
      copyStatus.textContent =
        "Kopieren ist nicht moeglich. Bitte markiere und kopiere die Server-Adresse manuell.";
    }
  });
  logout.addEventListener("click", () => {
    try {
      auth?.clear();
      clearTimers();
      active = false;
      generation += 1;
      details.hidden = true;
      startupWarning.hidden = true;
      win.location.replace("./index.html");
    } catch {
      requireLogin();
      status.textContent =
        "Die Anmeldung konnte nicht aus dem Sitzungsspeicher entfernt werden. Bitte schliesse diesen Tab.";
    }
  });
  win.addEventListener("pagehide", () => {
    active = false;
    generation += 1;
    busy = false;
    clearTimers();
    auth?.suspend();
    details.hidden = true;
    startupWarning.hidden = true;
    copyStatus.hidden = true;
    refresh.disabled = true;
    start.disabled = true;
    copy.disabled = true;
    address = undefined;
    for (const id of [
      "address",
      "ip",
      "ec2-state",
      "service-state",
      "client-mods",
      "server-mods",
    ]) {
      doc.getElementById(id).replaceChildren();
    }
  });
  win.addEventListener("pageshow", async (event) => {
    if (event.persisted) {
      active = true;
      try {
        auth?.restore();
        loadStartup();
      } catch {
        requireLogin();
        status.textContent =
          "Die Anmeldung konnte nicht aus dem Sitzungsspeicher geladen werden. Bitte lade die Seite erneut.";
        return;
      }
      await update();
    }
  });
  try {
    auth = createAuth(win.sessionStorage, fetcher);
    loadStartup();
  } catch {
    requireLogin();
    status.textContent =
      "Die Anmeldung konnte nicht aus dem Sitzungsspeicher geladen werden. Bitte erlaube ihn im Browser und lade die Seite erneut.";
    return;
  }
  if (!auth.hasSession()) {
    requireLogin();
    return;
  }
  logout.disabled = false;
  await update();
}

if (typeof document !== "undefined") {
  startServer();
}

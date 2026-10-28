import { createAuth } from "./auth.mjs";
import { createProfile } from "./profile.mjs";
import { SafeError, scrubFragment } from "./site.mjs";

export function renderServer(doc, value) {
  doc.getElementById("address").textContent = value.address;
  const mods = doc.getElementById("mods");
  mods.replaceChildren();
  for (const [source, names] of [
    ["client", value.mods.client.map((mod) => mod.name)],
    ["server", value.mods.server],
  ]) {
    for (const filename of names) {
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      const url = new URL("https://modrinth.com/discover/mods");
      url.searchParams.set("q", filename.replace(/\.jar$/i, ""));
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      const name = doc.createElement("span");
      name.className = "mod-name";
      name.textContent = filename;
      const origin = doc.createElement("small");
      origin.className = "mod-source";
      origin.textContent = `Source: ${source} folder`;
      name.append(origin);
      const action = doc.createElement("span");
      action.className = "download-label";
      action.textContent = "Find on Modrinth";
      link.append(name, action);
      item.append(link);
      mods.append(item);
    }
  }
  if (!mods.children.length) {
    const item = doc.createElement("li");
    item.textContent = "No mods needed. You're ready to join.";
    mods.append(item);
  }
}

export async function startServer(
  doc = document,
  win = window,
  fetcher = fetch,
) {
  scrubFragment(win);
  let auth;
  let profile;
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
      countdown.textContent = `Checking again in ${seconds} s. You can leave this page open.`;
      progress.value = 30 - seconds;
      showStartupWarning();
    }
    showCountdown();
    countdownTimer = win.setInterval(showCountdown, 1000);
    pollTimer = win.setTimeout(() => update(), 30000);
  }

  function requireLogin() {
    profile?.stop();
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
      "Your sign-in is missing or has expired. Sign in again to continue.";
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
      method === "POST" ? "Requesting start..." : "Start server";
    refresh.textContent = "Loading...";
    details.setAttribute("aria-busy", "true");
    status.textContent =
      method === "POST"
        ? "Starting your world..."
        : "Checking server status...";
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
        status.textContent = "Your world is ready. Happy building!";
        noticeTitle.textContent = "Come on in";
        noticeText.textContent =
          "Copy the server address and add it in Minecraft under Multiplayer. Automatic status checks have finished.";
      } else if (polling) {
        const starting =
          startup?.requested ||
          value.serviceState.pending > 0 ||
          value.serviceState.running === 0;
        status.textContent = starting
          ? "Your world is starting. We'll check every 30 seconds."
          : "Minecraft isn't responding yet. We'll check every 30 seconds.";
        noticeTitle.textContent = starting
          ? "Getting your world ready"
          : "Waiting for Minecraft";
        noticeText.textContent = starting
          ? "Starting can take up to 5 minutes. Download your mods and save your username while you wait."
          : "The server is running, but Minecraft hasn't answered yet. It may still be starting or need the admin's attention.";
      } else {
        status.textContent = canStart
          ? "The server is off. Start it when you're ready to play."
          : "The server is shutting down. Refresh the status in a little while.";
        noticeTitle.textContent = canStart
          ? "Ready when you are"
          : "Taking a break";
        noticeText.textContent = canStart
          ? "Start the server above. Before joining, download the mods below and save your Minecraft username."
          : "Once the server is off, you can start it again.";
      }
    } catch (error) {
      if (!active || requestGeneration !== generation) {
        return;
      }
      if (error.kind === "expired") {
        requireLogin();
      } else if (error.kind === "storage") {
        status.textContent =
          "Session storage is unavailable. Allow it in your browser and reload this page.";
      } else if (error.kind === "response") {
        status.textContent =
          "The server response couldn't be read safely. Refresh the status to try again.";
      } else {
        status.textContent =
          "The server couldn't be reached. Check your connection and refresh the status to try again.";
      }
    } finally {
      if (requestGeneration === generation) {
        busy = false;
        refresh.disabled = !active || !auth?.hasSession();
        start.disabled = !active || !auth?.hasSession() || !canStart;
        start.textContent = "Start server";
        refresh.textContent = "Refresh status";
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
    copyStatus.textContent = "Copying address...";
    try {
      if (!win.navigator?.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await win.navigator.clipboard.writeText(address);
      if (!active || requestGeneration !== generation) {
        return;
      }
      copyStatus.textContent = "Server address copied.";
    } catch {
      if (!active || requestGeneration !== generation) {
        return;
      }
      copyStatus.textContent =
        "Copying isn't available. Select the server address and copy it manually.";
    }
  });
  logout.addEventListener("click", () => {
    try {
      auth?.clear();
      profile?.stop();
      clearTimers();
      active = false;
      generation += 1;
      details.hidden = true;
      startupWarning.hidden = true;
      win.location.replace("./index.html");
    } catch {
      requireLogin();
      status.textContent =
        "Your sign-in couldn't be removed from session storage. Close this tab to sign out.";
    }
  });
  win.addEventListener("pagehide", () => {
    profile?.stop();
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
    for (const id of ["address", "mods"]) {
      doc.getElementById(id).replaceChildren();
    }
  });
  win.addEventListener("pageshow", async (event) => {
    if (event.persisted) {
      active = true;
      try {
        auth?.restore();
        loadStartup();
        if (auth?.hasSession()) {
          profile?.start();
        }
      } catch {
        requireLogin();
        status.textContent =
          "Your sign-in couldn't be loaded from session storage. Reload this page to try again.";
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
      "Your sign-in couldn't be loaded. Allow session storage in your browser and reload this page.";
    return;
  }
  if (!auth.hasSession()) {
    requireLogin();
    return;
  }
  logout.disabled = false;
  profile = createProfile(doc, win, auth, requireLogin);
  profile.start();
  await update();
}

if (typeof document !== "undefined") {
  startServer();
}

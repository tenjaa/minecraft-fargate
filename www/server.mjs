import {
  SITE_CONFIG as config,
  consumeTransfer,
  fetchServer,
  safeDownloadUrl,
  scrubFragment,
} from "./site.mjs";

export function renderServer(doc, value) {
  for (const [id, content] of [
    ["address", value.address],
    ["ip", value.ip ?? "Wird noch zugewiesen"],
    ["ec2-state", value.ec2State],
    [
      "service-state",
      `${value.serviceState.running} aktiv · ${value.serviceState.pending} im Start`,
    ],
  ])
    doc.getElementById(id).textContent = content;
  const clients = doc.getElementById("client-mods");
  const servers = doc.getElementById("server-mods");
  clients.replaceChildren();
  servers.replaceChildren();
  for (const mod of value.mods.client) {
    const item = doc.createElement("li");
    const link = doc.createElement("a");
    const url = safeDownloadUrl(mod.url);
    if (!url) continue;
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
  let token;
  try {
    token = consumeTransfer(win.sessionStorage);
  } catch {
    /* Storage may be blocked. */
  }
  const status = doc.getElementById("status");
  const refresh = doc.getElementById("refresh");
  const login = doc.getElementById("login-link");
  const details = doc.getElementById("server-details");
  let active = true;
  let busy = false;
  function requireLogin() {
    token = undefined;
    details.hidden = true;
    refresh.disabled = true;
    login.hidden = false;
    status.textContent =
      "Dein Zugang fehlt oder ist abgelaufen. Bitte melde dich erneut an.";
  }
  async function update() {
    if (!active || busy || !token) return;
    busy = true;
    refresh.disabled = true;
    refresh.textContent = "Wird geladen ...";
    details.hidden = true;
    details.setAttribute("aria-busy", "true");
    status.textContent =
      "Deine Welt wird gestartet und der Status abgerufen ...";
    try {
      const value = await fetchServer(config, token, fetcher);
      if (!active || !token) return;
      renderServer(doc, value);
      details.hidden = false;
      status.textContent =
        "Status aktualisiert. Der Start kann bis zu 5 Minuten dauern.";
    } catch (error) {
      if (!active || !token) return;
      if (error.kind === "expired") requireLogin();
      else if (error.kind === "response")
        status.textContent =
          "Die Serverantwort konnte nicht sicher gelesen werden. Bitte versuche es erneut.";
      else
        status.textContent =
          "Der Server ist gerade nicht erreichbar. Bitte pruefe deine Verbindung und versuche es erneut.";
    } finally {
      busy = false;
      refresh.disabled = !active || !token;
      refresh.textContent = "Status aktualisieren";
      details.setAttribute("aria-busy", "false");
    }
  }
  refresh.addEventListener("click", update);
  win.addEventListener("pagehide", () => {
    active = false;
    requireLogin();
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
  win.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      active = true;
      requireLogin();
    }
  });
  if (!token) {
    requireLogin();
    return;
  }
  await update();
}

if (typeof document !== "undefined") startServer();

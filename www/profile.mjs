export function createProfile(doc, win, auth, onExpired) {
  const section = doc.getElementById("profile-section");
  const form = doc.getElementById("profile-form");
  const input = doc.getElementById("minecraft-name");
  const current = doc.getElementById("profile-current");
  const status = doc.getElementById("profile-status");
  const save = doc.getElementById("profile-save");
  const remove = doc.getElementById("profile-remove");
  const refresh = doc.getElementById("profile-refresh");
  let active = false;
  let busy = false;
  let dirty = false;
  let loaded = false;
  let profile = null;
  let timer;
  let generation = 0;

  function controls() {
    input.disabled = !active || busy || !loaded;
    save.disabled = !active || busy || !loaded;
    remove.disabled = !active || busy || !loaded || !profile;
    refresh.disabled = !active || busy;
    form.setAttribute("aria-busy", String(busy));
  }

  async function update(method = "GET") {
    if (!active || busy) {
      return;
    }
    win.clearTimeout(timer);
    const expectedGeneration = generation;
    const payload = method === "PUT" ? { name: input.value.trim() } : undefined;
    busy = true;
    controls();
    if (method !== "GET") {
      status.textContent = "Zuordnung wird gespeichert ...";
    }
    try {
      const value = await auth.request(method, "profile", payload);
      if (!active || expectedGeneration !== generation) {
        return;
      }
      profile = value.profile;
      loaded = true;
      current.textContent = profile
        ? `Verknuepft: ${profile.name}`
        : "Noch kein Minecraft-Account verknuepft.";
      if (method !== "GET" || !dirty) {
        input.value = profile?.name ?? "";
        dirty = false;
      }
      status.textContent = {
        applied:
          "Minecraft hat die Allowlist-Aktualisierung bestaetigt. Geteilte Accounts bleiben zugelassen, solange eine aktive Zuordnung besteht.",
        pending:
          "Synchronisation ausstehend. Bei laufendem Server wird die Allowlist normalerweise nach etwa einer Minute aktualisiert, sonst nach dem naechsten Start.",
        failed:
          "Minecraft konnte die Allowlist-Aktualisierung nicht bestaetigen. Gespeicherte Zuordnungen bleiben erhalten; die Synchronisation wird automatisch erneut versucht. Bei ausgeschaltetem Server erfolgt sie nach dem naechsten Start.",
      }[value.synchronization.state];
    } catch (error) {
      if (!active || expectedGeneration !== generation) {
        return;
      }
      if (error.kind === "expired") {
        onExpired();
        return;
      }
      status.textContent =
        {
          "invalid-name":
            "Bitte gib einen Minecraft-Java-Namen mit 3 bis 16 Zeichen ein: Buchstaben, Ziffern oder Unterstrich.",
          "unknown-player":
            "Dieser Minecraft-Java-Account wurde nicht gefunden.",
          storage:
            "Der Sitzungsspeicher ist nicht verfuegbar. Bitte lade die Seite erneut.",
          response:
            "Die Profilantwort konnte nicht sicher gelesen werden. Bitte aktualisiere die Zuordnung erneut.",
        }[error.kind] ??
        "Die Profilanfrage ist fehlgeschlagen. Ob eine Aenderung gespeichert wurde, kannst du mit Zuordnung aktualisieren pruefen.";
    } finally {
      if (expectedGeneration === generation) {
        busy = false;
        controls();
        if (active) {
          timer = win.setTimeout(() => update(), 30000);
        }
      }
    }
  }

  input.addEventListener("input", () => {
    dirty = true;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loaded) {
      return update("PUT");
    }
  });
  remove.addEventListener("click", () => {
    if (profile) {
      return update("DELETE");
    }
  });
  refresh.addEventListener("click", () => update());

  function stop() {
    active = false;
    generation += 1;
    win.clearTimeout(timer);
    busy = false;
    dirty = false;
    loaded = false;
    profile = null;
    input.value = "";
    current.textContent = "";
    status.textContent = "";
    section.hidden = true;
    controls();
  }

  function start() {
    if (active) {
      return;
    }
    active = true;
    section.hidden = false;
    status.textContent = "Minecraft-Zuordnung wird geladen ...";
    update();
  }

  return { start, stop };
}

export function createProfile(doc, win, auth, onExpired) {
  const section = doc.getElementById("profile-section");
  const form = doc.getElementById("profile-form");
  const input = doc.getElementById("minecraft-name");
  const current = doc.getElementById("profile-current");
  const status = doc.getElementById("profile-status");
  const save = doc.getElementById("profile-save");
  const retry = doc.getElementById("profile-retry");
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
    save.textContent = profile ? "Update username" : "Save username";
    retry.disabled = !active || busy;
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
    retry.hidden = true;
    controls();
    if (method !== "GET") {
      status.textContent = "Saving username...";
    }
    try {
      const value = await auth.request(method, "profile", payload);
      if (!active || expectedGeneration !== generation) {
        return;
      }
      profile = value.profile;
      loaded = true;
      current.textContent = profile
        ? `Saved username: ${profile.name}`
        : "No username saved yet.";
      if (method !== "GET" || !dirty) {
        input.value = profile?.name ?? "";
        dirty = false;
      }
      status.textContent = profile
        ? "Username saved. This page can't confirm when server access takes effect."
        : "Enter your Minecraft username to get started.";
    } catch (error) {
      if (!active || expectedGeneration !== generation) {
        return;
      }
      if (error.kind === "expired") {
        onExpired();
        return;
      }
      retry.hidden = false;
      status.textContent =
        {
          "invalid-name":
            "Enter a Java Edition username with 3 to 16 letters, numbers, or underscores.",
          "unknown-player":
            "That Minecraft Java account wasn't found. Check the username and try again.",
          storage:
            "Session storage is unavailable. Reload this page to try again.",
          response:
            "Your account response couldn't be read safely. Try again to check the saved username.",
        }[error.kind] ??
        "Your account couldn't be reached. Try again to check whether the username was saved.";
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
  retry.addEventListener("click", () => update());

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
    retry.hidden = true;
    controls();
  }

  function start() {
    if (active) {
      return;
    }
    active = true;
    section.hidden = false;
    status.textContent = "Loading your Minecraft username...";
    update();
  }

  return { start, stop };
}

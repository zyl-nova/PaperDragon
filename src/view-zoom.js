(function initializeViewZoom(global) {
  const MIN_ZOOM = 0.6;
  const MAX_ZOOM = 1.6;
  const STEP = 0.1;
  const storageKey = "paper-agent-workspace-zoom";
  const level = document.querySelector("#viewZoomLevel");
  const controls = document.querySelector("#viewZoomControls");
  if (!level || !controls) return;

  let zoom = clamp(Number(global.localStorage.getItem(storageKey)) || 1);
  let wheelLocked = false;

  function clamp(value) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 10) / 10));
  }

  function updateLabel() {
    level.textContent = `${Math.round(zoom * 100)}%`;
  }

  async function applyZoom(nextZoom) {
    zoom = clamp(nextZoom);
    global.localStorage.setItem(storageKey, String(zoom));
    if (global.DesktopPet?.isDesktop) {
      zoom = clamp(await global.DesktopPet.setZoom(zoom));
    } else {
      document.documentElement.style.zoom = String(zoom);
    }
    updateLabel();
  }

  function isWorkspaceActive() {
    return !global.DesktopPet?.isDesktop || document.documentElement.classList.contains("desktop-workspace-mode");
  }

  controls.addEventListener("click", (event) => {
    const action = event.target.closest("[data-view-zoom]")?.dataset.viewZoom;
    if (action === "in") void applyZoom(zoom + STEP);
    if (action === "out") void applyZoom(zoom - STEP);
    if (action === "reset") void applyZoom(1);
  });

  document.addEventListener("keydown", (event) => {
    if (!isWorkspaceActive() || !event.ctrlKey) return;
    if (["+", "=", "Add"].includes(event.key)) {
      event.preventDefault();
      void applyZoom(zoom + STEP);
    } else if (["-", "Subtract"].includes(event.key)) {
      event.preventDefault();
      void applyZoom(zoom - STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      void applyZoom(1);
    }
  });

  document.addEventListener("wheel", (event) => {
    if (!isWorkspaceActive() || !event.ctrlKey) return;
    event.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;
    void applyZoom(zoom + (event.deltaY < 0 ? STEP : -STEP));
    setTimeout(() => { wheelLocked = false; }, 70);
  }, { passive: false, capture: true });

  global.addEventListener("paper-agent-zoom-request", (event) => {
    if (!isWorkspaceActive()) return;
    if (event.detail?.reset) {
      void applyZoom(1);
      return;
    }
    const direction = Number(event.detail?.direction || 0);
    if (!direction || wheelLocked) return;
    wheelLocked = true;
    void applyZoom(zoom + (direction > 0 ? STEP : -STEP));
    setTimeout(() => { wheelLocked = false; }, 70);
  });

  global.addEventListener("paper-agent-workspace-opened", () => {
    void applyZoom(zoom);
  });

  updateLabel();
  if (!global.DesktopPet?.isDesktop) void applyZoom(zoom);
})(window);

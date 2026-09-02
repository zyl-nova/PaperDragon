(function initializeDesktopShell(global) {
  const desktop = global.DesktopPet;
  if (!desktop?.isDesktop) return;

  const root = document.documentElement;
  function setMode(mode) {
    root.classList.toggle("desktop-pet-mode", mode === "pet");
    root.classList.toggle("desktop-workspace-mode", mode === "workspace");
  }

  async function showWorkspace() {
    await desktop.showWorkspace();
    setMode("workspace");
    global.dispatchEvent(new CustomEvent("paper-agent-workspace-opened"));
  }

  async function showPet() {
    await desktop.setZoom?.(1);
    setMode("pet");
    global.dispatchEvent(new CustomEvent("paper-agent-pet-opened"));
    await desktop.showPet();
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-desktop-action]")?.dataset.desktopAction;
    if (action === "workspace") void showWorkspace();
    if (action === "pet") void showPet();
    if (action === "minimize") desktop.minimize();
    if (action === "maximize") desktop.toggleMaximize();
    if (action === "close") desktop.close();
  });

  setMode("pet");
  global.DesktopPetShell = { showWorkspace, showPet };
})(window);

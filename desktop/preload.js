const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DesktopPet", {
  isDesktop: true,
  startDrag: () => ipcRenderer.send("desktop:drag-start"),
  moveDrag: () => ipcRenderer.send("desktop:drag-move"),
  endDrag: () => ipcRenderer.send("desktop:drag-end"),
  showWorkspace: () => ipcRenderer.invoke("desktop:show-workspace"),
  showPet: () => ipcRenderer.invoke("desktop:show-pet"),
  minimize: () => ipcRenderer.send("desktop:minimize"),
  toggleMaximize: () => ipcRenderer.send("desktop:toggle-maximize"),
  setZoom: (value) => ipcRenderer.invoke("desktop:set-zoom", value),
  getZoom: () => ipcRenderer.invoke("desktop:get-zoom"),
  close: () => ipcRenderer.send("desktop:close")
});

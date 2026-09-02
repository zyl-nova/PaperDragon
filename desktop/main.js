const path = require("path");
const { app, BrowserWindow, ipcMain, screen, shell } = require("electron");
const server = require("../server");

const PET_SIZE = { width: 360, height: 330 };
const WORKSPACE_SIZE = { width: 1320, height: 860 };
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;
let appUrl = "";
let mainWindow = null;
let dragState = null;

app.setName("PaperDragon");
app.setAppUserModelId("com.paperdragon.desktop");

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  appUrl = await startLocalServer();
  registerDesktopIpc();
  createDesktopPetWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server.listening) server.close();
});

function startLocalServer() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function createDesktopPetWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
    title: "PaperDragon",
    ...PET_SIZE,
    x: area.x + area.width - PET_SIZE.width - 20,
    y: area.y + area.height - PET_SIZE.height - 20,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.loadURL(`${appUrl}/?desktopPet=1`);
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
      return { action: "deny" };
    }
    if (/^blob:/i.test(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    }
    return { action: "deny" };
  });
}

function registerDesktopIpc() {
  ipcMain.on("desktop:drag-start", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    dragState = { win, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  });

  ipcMain.on("desktop:drag-move", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!dragState || dragState.win !== win) return;
    const cursor = screen.getCursorScreenPoint();
    win.setPosition(
      Math.round(dragState.bounds.x + cursor.x - dragState.cursor.x),
      Math.round(dragState.bounds.y + cursor.y - dragState.cursor.y)
    );
  });

  ipcMain.on("desktop:drag-end", () => {
    dragState = null;
  });

  ipcMain.handle("desktop:show-workspace", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.setAlwaysOnTop(false);
    win.setSkipTaskbar(false);
    win.setResizable(true);
    win.setMaximizable(true);
    win.setMinimumSize(980, 680);
    win.setSize(WORKSPACE_SIZE.width, WORKSPACE_SIZE.height);
    win.center();
    win.show();
    win.focus();
  });

  ipcMain.handle("desktop:show-pet", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.unmaximize();
    win.setMinimumSize(PET_SIZE.width, PET_SIZE.height);
    win.setSize(PET_SIZE.width, PET_SIZE.height);
    win.setResizable(false);
    win.setMaximizable(false);
    win.setSkipTaskbar(true);
    win.setAlwaysOnTop(true, "floating");
  });

  ipcMain.on("desktop:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("desktop:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on("desktop:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("desktop:set-zoom", (event, requestedZoom) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return 1;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(requestedZoom) || 1));
    win.webContents.setZoomFactor(zoom);
    return win.webContents.getZoomFactor();
  });
  ipcMain.handle("desktop:get-zoom", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.webContents.getZoomFactor() || 1;
  });
}

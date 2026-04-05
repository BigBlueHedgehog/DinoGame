/**
 * main.js — Electron main процесс
 * Отвечает за создание окна приложения и управление жизненным циклом
 */

require('electron-reload')(__dirname, {
  electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
  hardResetMethod: 'exit',
  watch: ['main.js']
});

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

/**
 * Создаёт главное окно приложения
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,          // Фиксированная ширина
    height: 400,         // Фиксированная высота
    resizable: false,    // Запрет изменения размера
    frame: true,         // Рамка окна (false — совсем без рамки)
    show: false,         // Показываем после загрузки для плавности
    icon: path.join(__dirname, 'assets', 'icon.png'), // Иконка приложения
    webPreferences: {
      nodeIntegration: true,   // Доступ к Node.js API в renderer
      contextIsolation: false, // Отключаем изоляцию для простоты
    },
  });

  // Загружаем основной HTML-файл
  mainWindow.loadFile('index.html');

  // Убираем стандартное меню (File, Edit, View и т.д.)
  mainWindow.setMenuBarVisibility(false);

  // Показываем окно после полной загрузки
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // При закрытии окна — обнуляем ссылку
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ========================
// Обработчики событий app
// ========================

// Когда Electron инициализирован — создаём окно
app.whenReady().then(createWindow);

// macOS: при клике на док, если окна нет — создаём заново
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Закрываем приложение, когда все окна закрыты (кроме macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ========================
// IPC-обработчики (связь main <-> renderer)
// ========================

// Запрос версии Electron (для отладки)
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

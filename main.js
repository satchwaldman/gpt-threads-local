import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import Store from 'electron-store';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new Store({ name: 'gpt-threads' });

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 420, height: 700, minWidth: 380,
    title: 'GPT Threads',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('renderer.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- Storage IPC ---
ipcMain.handle('getState', () => store.get('state', { apiKey: '', model: 'gpt-4.1-mini', threads: [] }));
ipcMain.handle('setState', (e, next) => { store.set('state', next); return true; });

// --- OpenAI Responses API (non-stream for simplicity) ---
ipcMain.handle('ask', async (e, { apiKey, model, context, history, user }) => {
  if (!apiKey) throw new Error('No API key');
  const input = [
    `Use context if relevant.\n\nContext:\n${context || '(none)'}`,
    (history && history.length ? `\n\nHistory:\n${history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')}` : ''),
    `\n\nUser: ${user}\nAssistant:`
  ].join('');
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input, stream: false })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(()=>'');
    throw new Error(`HTTP ${resp.status}: ${t || resp.statusText}`);
  }
  const j = await resp.json();
  // prefer output_text if present, else stitch from output items
  let text = '';
  if (typeof j.output_text === 'string') text = j.output_text;
  else if (Array.isArray(j.output)) {
    text = j.output.map(item => {
      const c = Array.isArray(item?.content) ? item.content : [item?.content];
      return c.filter(seg => seg && typeof seg.text === 'string').map(seg => seg.text).join('');
    }).join('');
  }
  return { text: text || '[no text]' };
});

// --- Jump (AppleScript via osascript) ---
// Brings ChatGPT app/browser to front, Command-F, paste anchor, Return.
// For “Next”, we just send Command-G.
function runOSA(script) {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-e', script], (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout);
    });
  });
}

ipcMain.handle('jumpToAnchor', async (e, { anchor, targetApp }) => {
  const appName = targetApp || 'ChatGPT';
  const esc = s => s.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const script = `
    tell application "${esc(appName)}" to activate
    tell application "System Events"
      keystroke "f" using {command down}
      delay 0.05
      keystroke "${esc(anchor)}"
      key code 36 -- Return
    end tell
  `;
  await runOSA(script);
  return true;
});

ipcMain.handle('jumpNext', async (e, { targetApp }) => {
  const appName = targetApp || 'ChatGPT';
  const script = `
    tell application "${appName}" to activate
    tell application "System Events" to keystroke "g" using {command down}
  `;
  await runOSA(script);
  return true;
});

// Optional: open links externally
ipcMain.on('openExternal', (e, url) => shell.openExternal(url));
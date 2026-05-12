const $ = (id) => document.getElementById(id);
const toggleBtn  = $('toggle');
const statusEl   = $('status');
const hintEl     = $('hint');
const apiKeyEl   = $('apiKey');
const langEl     = $('lang');
const volEl      = $('vol');
const volLabel   = $('volLabel');
const settingsEl = $('settings');

let currentTabId = null;

const TAB_KEY = (tabId) => `dub:${tabId}`;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadSettings() {
  const { apiKey = '', lang = 'lv', vol = 20 } =
    await chrome.storage.local.get(['apiKey', 'lang', 'vol']);
  apiKeyEl.value = apiKey;
  langEl.value = lang;
  volEl.value = vol;
  volLabel.textContent = vol + '%';
  return { apiKey, lang, vol };
}

async function loadTabState() {
  const key = TAB_KEY(currentTabId);
  const data = await chrome.storage.session.get(key);
  return !!data[key];
}

function renderState(on, hasKey) {
  if (on) {
    toggleBtn.textContent = 'Stop dubbing';
    toggleBtn.classList.add('on');
    statusEl.textContent = 'on';
    statusEl.classList.add('on');
  } else {
    toggleBtn.textContent = 'Start dubbing';
    toggleBtn.classList.remove('on');
    statusEl.textContent = 'off';
    statusEl.classList.remove('on');
  }
  toggleBtn.disabled = !hasKey;
  hintEl.classList.toggle('hidden', hasKey);
  if (!hasKey && !on) settingsEl.open = true;
}

async function ensureContentScript(tabId) {
  // Idempotent: content.js's IIFE no-ops on repeat injection.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function startDubbing() {
  console.log('[popup] startDubbing tabId=', currentTabId);
  await ensureContentScript(currentTabId);
  const vol = Number(volEl.value) / 100;
  const lang = langEl.value;
  const resp = await chrome.tabs.sendMessage(currentTabId, {
    target: 'content',
    type: 'START',
    vol,
    lang,
  });
  console.log('[popup] content START response:', resp);
  if (!resp) throw new Error('content script did not respond');
  if (resp.error) throw new Error(resp.error);
}

async function stopDubbing() {
  try {
    await chrome.tabs.sendMessage(currentTabId, {
      target: 'content',
      type: 'STOP',
    });
  } catch {}
}

async function init() {
  const tab = await getActiveTab();
  currentTabId = tab.id;
  const { apiKey } = await loadSettings();
  const on = await loadTabState();
  renderState(on, !!apiKey);
}

apiKeyEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ apiKey: apiKeyEl.value.trim() });
  const on = await loadTabState();
  renderState(on, !!apiKeyEl.value.trim());
});

langEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ lang: langEl.value });
});

volEl.addEventListener('input', () => {
  volLabel.textContent = volEl.value + '%';
});

volEl.addEventListener('change', async () => {
  const v = Number(volEl.value);
  await chrome.storage.local.set({ vol: v });
  const on = await loadTabState();
  if (on) {
    try {
      await chrome.tabs.sendMessage(currentTabId, {
        target: 'content',
        type: 'SET_VOL',
        vol: v / 100,
      });
    } catch {}
  }
});

toggleBtn.addEventListener('click', async () => {
  if (currentTabId == null) return;
  const key = TAB_KEY(currentTabId);
  const data = await chrome.storage.session.get(key);
  const isOn = !!data[key];

  toggleBtn.disabled = true;
  toggleBtn.textContent = isOn ? 'Stopping…' : 'Starting…';

  try {
    if (isOn) {
      await stopDubbing();
      await chrome.storage.session.remove(key);
      renderState(false, !!apiKeyEl.value.trim());
    } else {
      await startDubbing();
      await chrome.storage.session.set({ [key]: true });
      renderState(true, !!apiKeyEl.value.trim());
    }
  } catch (e) {
    console.error('toggle failed:', e);
    alert('Failed: ' + (e.message || e));
    renderState(isOn, !!apiKeyEl.value.trim());
  }
});

init();

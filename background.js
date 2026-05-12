// Service worker: tracks per-tab on/off state and reflects it in the action badge.
// Phase B scope: state plumbing only. Phase C wires this to actual tab capture
// and Phase D wires the OpenAI WebRTC peer.

const TAB_KEY = (tabId) => `dub:${tabId}`;

async function setBadge(tabId, on) {
  await chrome.action.setBadgeText({ tabId, text: on ? "ON" : "" });
  if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2a8a2a" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (!key.startsWith("dub:")) continue;
    const tabId = Number(key.slice(4));
    setBadge(tabId, !!newValue);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_CAPTURE',
      tabId,
    });
  } catch {} // offscreen may not exist
  await chrome.storage.session.remove(TAB_KEY(tabId));
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.session.clear();
});

// Phase D: token-mint + SDP-exchange relay for the content script.
// Runs in the service worker so api.openai.com fetches use extension permissions
// rather than the YouTube tab's CSP.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'background') return false;

  (async () => {
    try {
      if (msg.type !== 'SETUP_TRANSLATION') {
        sendResponse({ error: 'unknown background msg type: ' + msg.type });
        return;
      }

      const { apiKey } = await chrome.storage.local.get('apiKey');
      if (!apiKey) {
        sendResponse({ error: 'no API key set in extension settings' });
        return;
      }

      // 1) Mint an ephemeral client_secret
      const mintR = await fetch(
        'https://api.openai.com/v1/realtime/translations/client_secrets',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ session: { model: 'gpt-realtime-translate' } }),
        }
      );
      const mintText = await mintR.text();
      let mintData = null;
      try { mintData = JSON.parse(mintText); } catch {}
      if (!mintR.ok) {
        sendResponse({
          error: mintData?.error?.message || `mint ${mintR.status}: ${mintText.slice(0, 300)}`,
        });
        return;
      }
      const token =
        mintData?.value ||
        mintData?.client_secret?.value ||
        mintData?.client_secret;
      if (!token) {
        sendResponse({ error: 'no client_secret in response: ' + mintText.slice(0, 200) });
        return;
      }
      console.log('[bg] minted client_secret');

      // 2) Exchange SDP
      const sdpR = await fetch(
        'https://api.openai.com/v1/realtime/translations/calls',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/sdp',
          },
          body: msg.sdp,
        }
      );
      if (!sdpR.ok) {
        const errText = await sdpR.text();
        sendResponse({ error: `SDP exchange ${sdpR.status}: ${errText.slice(0, 300)}` });
        return;
      }
      const answerSdp = await sdpR.text();
      console.log('[bg] SDP exchange complete');
      sendResponse({ ok: true, answerSdp });
    } catch (e) {
      console.error('[bg]', msg.type, 'failed:', e);
      sendResponse({ error: e.message || String(e) });
    }
  })();

  return true; // async response
});

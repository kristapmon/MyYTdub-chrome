// Offscreen document: holds the audio capture and Web Audio graph for each tab.
// Phase C: captures tab audio + plays it back at attenuated volume.
// Phase D will add the OpenAI WebRTC peer for the translation track.

const captures = new Map(); // tabId -> { stream, audioContext, gainNode }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (msg.type) {
        case 'START_CAPTURE':
          await startCapture(msg.streamId, msg.tabId, msg.vol);
          sendResponse({ ok: true });
          break;
        case 'STOP_CAPTURE':
          stopCapture(msg.tabId);
          sendResponse({ ok: true });
          break;
        case 'SET_VOLUME':
          setVolume(msg.tabId, msg.vol);
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ error: 'unknown message type: ' + msg.type });
      }
    } catch (e) {
      console.error('[offscreen]', msg.type, 'failed:', e);
      sendResponse({ error: e.message || String(e) });
    }
  })();

  return true; // async response
});

async function startCapture(streamId, tabId, vol) {
  console.log('[offscreen] startCapture tabId=', tabId, 'streamId=', streamId, 'vol=', vol);
  if (captures.has(tabId)) stopCapture(tabId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
  });
  const track = stream.getAudioTracks()[0];
  console.log('[offscreen] getUserMedia ok; track:', {
    label: track.label,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  });

  const audioContext = new AudioContext();
  if (audioContext.state === 'suspended') await audioContext.resume();
  console.log('[offscreen] audioContext state=', audioContext.state, 'sampleRate=', audioContext.sampleRate);

  const source = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  gainNode.gain.value = vol;
  source.connect(gainNode).connect(audioContext.destination);
  console.log('[offscreen] graph connected; gain=', vol);

  // Diagnostic beep: 880 Hz for 0.4s at the same destination. If we hear this
  // but no captured audio, the captured stream is silent (mute-affects-capture).
  // If we hear nothing at all, the offscreen AudioContext destination isn't
  // reaching the speakers and we need an <audio>-element workaround.
  const osc = audioContext.createOscillator();
  const beepGain = audioContext.createGain();
  osc.frequency.value = 880;
  beepGain.gain.value = 0.1;
  osc.connect(beepGain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.4);
  console.log('[offscreen] diagnostic beep emitted');

  captures.set(tabId, { stream, audioContext, gainNode });
}

function stopCapture(tabId) {
  const c = captures.get(tabId);
  if (!c) return;
  try { c.stream.getTracks().forEach((t) => t.stop()); } catch {}
  try { c.gainNode.disconnect(); } catch {}
  try { c.audioContext.close(); } catch {}
  captures.delete(tabId);
}

function setVolume(tabId, vol) {
  const c = captures.get(tabId);
  if (c) c.gainNode.gain.value = vol;
}

// MyYTdub content script. Runs in the YouTube (or any) page's isolated world.
// Phase C: hooks the page's <video> through Web Audio so we can:
//   - control how loud the original is (userGain: 0..1)
//   - capture full-volume audio for translation (captureDest.stream)
// Phase D: opens an RTCPeerConnection to OpenAI gpt-realtime-translate; uses
// background.js as a relay for the token-mint + SDP-exchange (fetches to
// api.openai.com from a content script would hit YouTube's CSP).

(() => {
  if (window.__myYTdubInstalled) {
    console.log('[content] already installed; skipping setup');
    return;
  }
  window.__myYTdubInstalled = true;

  // Floating status pill on the page so we can see pipeline progress
  // without having to dig through DevTools.
  function getStatusEl() {
    let el = document.getElementById('myYTdubStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'myYTdubStatus';
      el.style.cssText = [
        'position:fixed',
        'top:8px',
        'right:8px',
        'z-index:2147483647',
        'background:rgba(0,0,0,0.85)',
        'color:#fff',
        'font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
        'padding:6px 10px',
        'border-radius:4px',
        'max-width:320px',
        'pointer-events:none',
        'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
      ].join(';');
      (document.body || document.documentElement).appendChild(el);
    }
    return el;
  }

  function setStatus(text, kind = 'info') {
    const el = getStatusEl();
    el.textContent = '🎙 ' + text;
    el.style.background = {
      info:   'rgba(0,0,0,0.85)',
      ok:     'rgba(30,120,30,0.92)',
      error:  'rgba(170,30,30,0.92)',
    }[kind] || 'rgba(0,0,0,0.85)';
    console.log('[content] status:', text);
  }

  function hideStatus() {
    const el = document.getElementById('myYTdubStatus');
    if (el) el.remove();
  }

  let state = null;
  // state = {
  //   audioContext, source, userGain, captureGain, captureDest, video,
  //   pc, dc, remoteSource,
  // }

  function setupAudio() {
    if (state) return state;

    const video = document.querySelector('video');
    if (!video) return null;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let source;
    try {
      source = audioContext.createMediaElementSource(video);
    } catch (e) {
      console.error('[content] createMediaElementSource failed:', e);
      return null;
    }

    const userGain = audioContext.createGain();
    userGain.gain.value = 1.0;

    const captureGain = audioContext.createGain();
    captureGain.gain.value = 1.0;

    const captureDest = audioContext.createMediaStreamDestination();

    source.connect(userGain).connect(audioContext.destination);
    source.connect(captureGain).connect(captureDest);

    state = {
      audioContext, source, userGain, captureGain, captureDest, video,
      pc: null, dc: null, remoteSource: null,
    };
    console.log('[content] graph attached to <video>; sampleRate=', audioContext.sampleRate);
    return state;
  }

  async function startTranslation(s, lang) {
    if (s.pc) {
      console.log('[content] translation already active; updating language only');
      if (s.dc?.readyState === 'open') {
        s.dc.send(JSON.stringify({
          type: 'session.update',
          session: { audio: { output: { language: lang } } },
        }));
      }
      return;
    }

    setStatus('preparing peer connection…');
    const pc = new RTCPeerConnection();
    s.pc = pc;

    const track = s.captureDest.stream.getAudioTracks()[0];
    pc.addTrack(track, s.captureDest.stream);

    const dc = pc.createDataChannel('oai-events');
    s.dc = dc;
    dc.onopen = () => {
      console.log('[content] data channel open; setting language=', lang);
      dc.send(JSON.stringify({
        type: 'session.update',
        session: { audio: { output: { language: lang } } },
      }));
    };
    let heardInput = false;
    let firstOutput = false;
    dc.onmessage = ({ data }) => {
      let m;
      try { m = JSON.parse(data); } catch { return; }
      const t = m.type || '';
      console.log('[content] event:', t);
      if (t === 'error' || t.endsWith('.error')) {
        console.error('[content] server error:', m);
        setStatus('server: ' + (m.error?.message || t), 'error');
      } else if (t.endsWith('input_transcript.delta') && !heardInput) {
        heardInput = true;
        setStatus('heard you ✓ generating Latvian…');
      } else if (t.endsWith('output_transcript.delta') && !firstOutput) {
        firstOutput = true;
        setStatus('translating ✓', 'ok');
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[content] pc state:', pc.connectionState);
      if (pc.connectionState === 'connecting') setStatus('connecting WebRTC…');
      else if (pc.connectionState === 'connected') setStatus('WebRTC connected; waiting for audio…');
      else if (pc.connectionState === 'failed') setStatus('WebRTC failed', 'error');
      else if (pc.connectionState === 'disconnected') setStatus('WebRTC disconnected', 'error');
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[content] ice:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') setStatus('ICE failed (network)', 'error');
    };

    pc.ontrack = (event) => {
      try {
        const stream = event.streams[0] || new MediaStream([event.track]);
        console.log('[content] remote track received; streams:', event.streams.length, 'track:', event.track?.kind);

        // Play via a hidden <audio> element. Web Audio routing of remote
        // WebRTC streams via createMediaStreamSource has been flaky here —
        // <audio srcObject> is the reliable path (smoketest used it).
        let audioEl = document.getElementById('myYTdubAudio');
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.id = 'myYTdubAudio';
          audioEl.autoplay = true;
          audioEl.style.display = 'none';
          (document.body || document.documentElement).appendChild(audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.play().catch((e) => {
          console.error('[content] audio.play() rejected:', e);
          setStatus('autoplay blocked — click page once', 'error');
        });
        s.audioEl = audioEl;
        setStatus('translating ✓', 'ok');
      } catch (e) {
        console.error('[content] ontrack handler failed:', e);
        setStatus('ontrack error: ' + e.message, 'error');
      }
    };

    setStatus('creating offer…');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log('[content] local SDP set; relaying through background');

    setStatus('minting token + exchanging SDP…');
    const resp = await chrome.runtime.sendMessage({
      target: 'background',
      type: 'SETUP_TRANSLATION',
      sdp: offer.sdp,
    });
    if (!resp) throw new Error('background did not respond to SETUP_TRANSLATION');
    if (resp.error) throw new Error(resp.error);

    await pc.setRemoteDescription({ type: 'answer', sdp: resp.answerSdp });
    console.log('[content] SDP exchange complete');
    setStatus('SDP done; waiting for ICE…');

    // Tell the browser to keep its inbound jitter buffer as short as possible.
    // Default is ~150–300ms of buffering; 0 plays packets as soon as they
    // arrive, at the cost of occasional crackles if the network blips.
    pc.getReceivers().forEach((r) => {
      if (r.track?.kind === 'audio' && 'playoutDelayHint' in r) {
        try {
          r.playoutDelayHint = 0;
          console.log('[content] playoutDelayHint = 0');
        } catch (e) {
          console.warn('[content] playoutDelayHint failed:', e);
        }
      }
    });

    // Periodic diagnostic: how many audio bytes we're sending to OpenAI.
    // If this stays at 0, our captureDest stream is silent.
    s._statsInterval = setInterval(async () => {
      if (!s.pc || s.pc.connectionState !== 'connected') return;
      const stats = await s.pc.getStats();
      let outBytes = 0;
      let inBytes = 0;
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') outBytes = r.bytesSent || 0;
        if (r.type === 'inbound-rtp'  && r.kind === 'audio') inBytes  = r.bytesReceived || 0;
      });
      console.log('[content] audio bytes — sent:', outBytes, 'received:', inBytes);
      if (!heardInput) {
        setStatus(`sent ${outBytes}B / recv ${inBytes}B — waiting for OpenAI…`);
      }
    }, 3000);
  }

  function stopTranslation(s) {
    if (s._statsInterval) {
      clearInterval(s._statsInterval);
      s._statsInterval = null;
    }
    if (s.audioEl) {
      try { s.audioEl.pause(); s.audioEl.srcObject = null; s.audioEl.remove(); } catch {}
      s.audioEl = null;
    }
    if (s.dc) {
      try { s.dc.close(); } catch {}
      s.dc = null;
    }
    if (s.pc) {
      try { s.pc.close(); } catch {}
      s.pc = null;
    }
    hideStatus();
    console.log('[content] translation stopped');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.target !== 'content') return false;

    (async () => {
      try {
        switch (msg.type) {
          case 'START': {
            const s = setupAudio();
            if (!s) {
              sendResponse({ error: 'no <video> element on this page' });
              return;
            }
            if (s.audioContext.state === 'suspended') await s.audioContext.resume();
            s.userGain.gain.value = typeof msg.vol === 'number' ? msg.vol : 0.2;
            console.log('[content] START userGain=', s.userGain.gain.value);
            await startTranslation(s, msg.lang || 'lv');
            sendResponse({ ok: true });
            break;
          }
          case 'STOP': {
            if (state) {
              state.userGain.gain.value = 1.0;
              stopTranslation(state);
              console.log('[content] STOP — userGain restored to 1.0');
            }
            sendResponse({ ok: true });
            break;
          }
          case 'SET_VOL': {
            if (state) {
              state.userGain.gain.value = msg.vol;
              console.log('[content] SET_VOL', msg.vol);
            }
            sendResponse({ ok: true });
            break;
          }
          default:
            sendResponse({ error: 'unknown type: ' + msg.type });
        }
      } catch (e) {
        console.error('[content]', msg.type, 'failed:', e);
        setStatus('error: ' + (e.message || e), 'error');
        sendResponse({ error: e.message || String(e) });
      }
    })();

    return true; // async sendResponse
  });

  console.log('[content] MyYTdub content script ready');
})();

# MyYTdub

A Chrome extension that translates any YouTube video into Latvian (or other languages) in real time, using OpenAI's `gpt-realtime-translate` model. Press a button, the original audio ducks down, a translated voice plays on top with a couple of seconds of lag.

Built for personal use to help non-English-speaking parents watch any-language content. **Not production-ready** — your OpenAI API key lives in browser storage, so this is intended for personal/local use, not distribution.

## Requirements

- Google Chrome (Manifest V3 — Chrome 116 or newer)
- An OpenAI API key with access to the Realtime API
- An OpenAI account funded with credit (about $0.034/min of dubbing — ~$2 per hour of viewing, ~$3 for a 90-minute movie)

## Install the extension

1. **Clone this repo** (or download as a ZIP and unzip).
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. The MyYTdub icon appears in your toolbar. Click the puzzle-piece icon and pin it for easy access.

## Configure

1. Click the MyYTdub toolbar icon to open the popup.
2. Expand **Settings**, paste your OpenAI API key into the field (it's stored in `chrome.storage.local` — local to your Chrome profile, never sent anywhere except OpenAI).
3. Pick the target language (default: Latvian).
4. Adjust the **Original volume** slider — this controls how loud the source language stays while the translation plays. 0% = source fully silenced, 100% = source at full volume mixed with translation. Around 10–20% works well for most viewing.

## Use it

1. Open a YouTube video. Press play.
2. Click the MyYTdub icon → **Start dubbing**.
3. A small status pill appears in the top-right of the YouTube page. Within 3–5 seconds it should show `translating ✓` (green).
4. You'll hear the translation arriving with about 2–5 seconds of lag — inherent to live speech-to-speech translation.
5. Click the icon again → **Stop dubbing** to return YouTube to its normal audio.

The volume slider works live — drag it during playback to find the level that works for you.

### What works

- Regular YouTube videos with HTML5 `<video>` elements (i.e. virtually everything on `youtube.com`)
- Long-form video (no per-video setup, but watch your API bill)
- Switching tabs — each tab tracks its own on/off state

### What doesn't work

- **DRM-protected content** (Netflix, Disney+, Prime Video, etc.) — Chrome blocks audio capture from protected media by design
- **Pages without standard `<video>` elements**
- **Multiple simultaneous languages** — one target language at a time, set per session

## Optional: smoke-test the translation endpoint

If you want to verify that OpenAI's translation model gives acceptable output for your target language *before* installing the extension, there's a small standalone tester in `scratch/`. It uses your mic instead of a YouTube video.

Requires a local PHP server (e.g. [MAMP](https://www.mamp.info/)) — the PHP file is just a tiny shim that mints the OpenAI ephemeral token server-side, since the OpenAI endpoint blocks browser-direct minting.

1. Copy `scratch/.openai-key.example` to `scratch/.openai-key`.
2. Paste your OpenAI API key into `scratch/.openai-key` (one line, no quotes, no whitespace).
3. Make sure your local server (MAMP or equivalent) is serving the project folder.
4. Visit `http://localhost/MyYTdub/scratch/smoketest.html` (adjust the host/port for your setup).
5. Pick a target language, click **Start**, speak a few sentences into your mic — you should hear translation back within a few seconds.

`scratch/.openai-key` is gitignored, so your key won't accidentally end up in a commit.

## Costs and safety

- `gpt-realtime-translate` is metered at roughly **$0.034 per minute** of dubbing. A 90-minute movie ≈ $3; an hour of casual watching ≈ $2. Check OpenAI's current pricing for the latest numbers.
- Your API key is stored in `chrome.storage.local`. Anyone with access to your Chrome profile can read it. **Do not publish this extension or share your unpacked folder with your API key in it.**
- Rotate your key periodically — and immediately if you suspect exposure — at https://platform.openai.com/api-keys.

## How it works (short version)

A content script injected into the YouTube tab uses Web Audio's `createMediaElementSource` on the page's `<video>`, splitting the audio into two branches: one (slider-controlled) plays the original to your speakers, the other (full volume) feeds a `MediaStreamAudioDestinationNode`. That captured stream is sent over WebRTC to `gpt-realtime-translate`. The translated audio comes back as a remote WebRTC track and plays through a hidden `<audio>` element on the page. The service worker handles the ephemeral-token mint and SDP exchange, so the OpenAI API key never has to leave the extension's own origin.

## License

Personal project. Use at your own risk.

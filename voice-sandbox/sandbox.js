// voice-sandbox/sandbox.js — Cleo's voice sandbox (Oren, 4 Nov 2026): a phone page that talks live with OpenAI's
// Realtime model over WebRTC, for fast iteration on how Cleo's voice feels, outside the console and its CI.
// The OpenAI key is typed once on the phone and kept in that phone's localStorage only; it is never in this repo
// (the Pages check refuses anything shaped like a key). The page mints a short-lived client secret with it, then
// opens the call with that secret. Interrupting mid-reply is the model's own server VAD. No company data here:
// this Cleo knows only what she is told in INSTRUCTIONS.

const $ = (id) => document.getElementById(id);
const KEY = 'voiceSandbox.openaiKey';
const PREFS = 'voiceSandbox.prefs';
const MODEL = 'gpt-realtime';
const COLORS = ['#c9a46a', '#7aa7ff', '#ff8a8a', '#7fdcb0', '#c79bff', '#f2f2f2'];

const INSTRUCTIONS = `את קליאו, ראש המטה של חברת Shultz and Weiss (Cleopatra), ומדברת עם אחד הדירקטורים, אורן או אלעד.
דברי עברית טבעית ומדוברת, חמה וישירה, כמו בן אדם בשיחת טלפון. משפט או שניים בכל פעם, בלי רשימות ובלי הקדמות.
אם קוטעים אותך, תפסיקי ותקשיבי. אם לא שמעת טוב, תשאלי שוב בקצרה.
זה סנדבוקס לבדיקת הקול: אין לך כאן גישה למערכות של החברה, למשימות או למסמכים. אם שואלים על משהו כזה, תגידי ביושר שבסנדבוקס את לא רואה את זה.`;

const prefs = Object.assign({ voice: 'marin', speed: 1.1, room: 'Cleo', color: COLORS[0] }, JSON.parse(localStorage.getItem(PREFS) || '{}'));
const savePrefs = () => localStorage.setItem(PREFS, JSON.stringify(prefs));
// opened from the console (+ → קול חדש), the room comes in the address: ?room=<the room's name>
const fromConsole = new URLSearchParams(location.search).get('room');
if (fromConsole) prefs.room = fromConsole.slice(0, 40);

let pc = null, dc = null, mic = null, raf = 0, wake = null, audioCtx = null;
const orb = $('orb');
const setStatus = (s) => { $('status').textContent = s; };
const hint = (s) => { $('hint').textContent = s; };

// ── settings ─────────────────────────────────────────────────────────────────────────────────────────────────────
$('key').value = localStorage.getItem(KEY) ? '••••••••' : '';
$('saveKey').onclick = () => {
  const v = $('key').value.trim();
  if (!v || v.startsWith('•')) return;
  localStorage.setItem(KEY, v); $('key').value = '••••••••'; hint('המפתח נשמר בטלפון הזה');
};
$('voice').value = prefs.voice;
$('voice').onchange = (e) => { prefs.voice = e.target.value; savePrefs(); if (pc) hint('הקול החדש יתחיל בשיחה הבאה'); };
$('speed').value = prefs.speed; $('speedV').textContent = prefs.speed;
$('speed').oninput = (e) => {
  prefs.speed = Number(e.target.value); $('speedV').textContent = prefs.speed; savePrefs();
  send({ type: 'session.update', session: { type: 'realtime', audio: { output: { speed: prefs.speed } } } });
};
if (![...$('roomSel').options].some((o) => o.value === prefs.room)) $('roomSel').append(new Option(prefs.room));
$('roomSel').value = prefs.room; $('room').textContent = prefs.room;
$('roomSel').onchange = (e) => { prefs.room = e.target.value; $('room').textContent = prefs.room; savePrefs(); };
for (const c of COLORS) {
  const b = document.createElement('button'); b.style.background = c; b.className = c === prefs.color ? 'on' : '';
  b.onclick = () => { prefs.color = c; savePrefs(); paintOrb(); for (const x of $('avatars').children) x.className = x === b ? 'on' : ''; };
  $('avatars').append(b);
}
function paintOrb() { orb.style.background = `radial-gradient(circle at 38% 34%, #ffffffcc 0%, ${prefs.color} 40%, #1b1d26 100%)`; }
paintOrb();

// ── the call ─────────────────────────────────────────────────────────────────────────────────────────────────────
function send(ev) { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(ev)); }

async function mintSecret(key) {
  const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: {
      type: 'realtime', model: MODEL, instructions: INSTRUCTIONS,
      audio: {
        input: { turn_detection: { type: 'server_vad', silence_duration_ms: 450, interrupt_response: true, create_response: true }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'he' } },
        output: { voice: prefs.voice, speed: prefs.speed },
      },
    } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.value) throw new Error(j?.error?.message || `OpenAI refused the key (HTTP ${r.status})`);
  return j.value;
}

async function start() {
  const key = localStorage.getItem(KEY);
  if (!key) { $('settings').open = true; hint('צריך קודם להדביק את המפתח בהגדרות'); return; }
  setStatus('מתחבר…'); hint('');
  try {
    const secret = await mintSecret(key);
    pc = new RTCPeerConnection();
    const out = new Audio(); out.autoplay = true;
    pc.ontrack = (e) => { out.srcObject = e.streams[0]; watchLevel(e.streams[0]); };
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    pc.addTrack(mic.getTracks()[0], mic);
    dc = pc.createDataChannel('oai-events');
    dc.onmessage = (m) => onEvent(JSON.parse(m.data));
    pc.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(pc?.connectionState)) stop('השיחה נותקה'); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const r = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/sdp' },
    });
    if (!r.ok) throw new Error(`OpenAI did not open the call (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    orb.className = 'listening'; setStatus('מחובר'); hint('מקשיבה · לחיצה מסיימת');
    holdScreen();
  } catch (e) {
    stop(); setStatus('לא מחובר'); hint(String(e?.message || e)); console.error(e);
  }
}

function stop(why) {
  cancelAnimationFrame(raf);
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  mic?.getTracks().forEach((t) => t.stop());
  pc = dc = mic = null;
  wake?.release?.().catch(() => {}); wake = null;
  orb.className = 'idle'; orb.style.transform = ''; orb.style.boxShadow = '';
  setStatus('לא מחובר'); if (why) hint(why); else if (!$('hint').textContent) hint('לחיצה על העיגול מתחילה שיחה');
}

let line = '';
function onEvent(ev) {
  if (ev.type === 'input_audio_buffer.speech_started') { orb.className = 'listening'; hint('שומעת אותך'); }
  if (ev.type === 'input_audio_buffer.speech_stopped') hint('חושבת');
  if (ev.type === 'response.output_audio_transcript.delta') { line += ev.delta; $('said').textContent = line; hint(''); }
  if (ev.type === 'response.created') line = '';
  if (ev.type === 'response.done') hint('מקשיבה · לחיצה מסיימת');
  if (ev.type === 'error') hint(ev.error?.message || 'שגיאה');
}

// the orb follows Cleo's own voice: its scale and glow are the output level
function watchLevel(stream) {
  audioCtx = audioCtx || new AudioContext();
  const an = audioCtx.createAnalyser(); an.fftSize = 512;
  audioCtx.createMediaStreamSource(stream).connect(an);
  const buf = new Uint8Array(an.fftSize);
  const tick = () => {
    an.getByteTimeDomainData(buf);
    let s = 0; for (const v of buf) s += (v - 128) ** 2;
    const lvl = Math.min(1, Math.sqrt(s / buf.length) / 40);
    orb.style.transform = `scale(${1 + lvl * 0.22})`;
    orb.style.boxShadow = `0 0 ${20 + lvl * 70}px ${lvl * 18}px ${prefs.color}55`;
    raf = requestAnimationFrame(tick);
  };
  tick();
}

// the screen stays on for the whole call, and the lock is taken again when the page comes back
async function holdScreen() { try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; } }
document.addEventListener('visibilitychange', () => { if (pc && document.visibilityState === 'visible') holdScreen(); });

orb.onclick = () => { if (pc) stop(); else start(); };

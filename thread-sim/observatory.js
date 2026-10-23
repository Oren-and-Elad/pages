// ── 🛰️ Ops Observatory — a live map of the persona org ─────────────────────────
// A read-only visual companion to the 📼 Flight-Recorder log: the same
// `elad-oren-trace` Firestore feed, rendered as a living constellation of seats
// (who's working, who's talking to whom, and how). Isolated ES module — its own
// scope, its own DOM inside #obs-modal, no globals leak into index.html's script.
//
// Data: subscribes to `elad-oren-trace` ONLY while open (the trace-modal pattern).
// When the sink is quiet/off it falls back to a clearly-labelled MODEL so the
// panel is never a dead screen; a Live/Model toggle switches at will. It never
// writes — the rules forbid it anyway.
//
// The org model (seats, rooms, clients, handoff edges) and the seven interaction
// classes mirror the kernel: constitution/personas/*, config/cleo.config.json,
// kernel/events-logic.mjs (EMIT_PERMISSIONS), kernel/trace-logic.mjs (classes).
// Per-class colours match the 📼 log exactly (index.html .trace-row.tc-*).
import { getApp } from './fb/firebase-app.js';
import { getFirestore, collection, query, orderBy, limit, onSnapshot, doc, setDoc, serverTimestamp, addDoc, updateDoc }
  from './fb/firebase-firestore.js';
import { getAuth } from './fb/firebase-auth.js';

(function () {
  if (window.CleoObservatory) return;               // idempotent

  /* =============================== helpers =============================== */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let db = null;
  const getDb = () => { try { return db || (db = getFirestore(getApp())); } catch { return null; } };

  /* =============================== the taxonomy =============================== */
  // order + colours mirror the 📼 trace log (lit = literal, varn = console token)
  const CLASSES = {
    turn:    { name: 'Working turn',    lit: '#5b9bd5', glyph: '◍', desc: 'A seat is running — reasoning, using tools, drafting.' },
    msg:     { name: 'Room message',    varn: '--green', glyph: '✉', desc: "A message inside a room — a director's ask, an ack." },
    comms:   { name: 'Client send',     varn: '--accent', glyph: '➤', desc: 'An outbound to a client (WhatsApp / email), gated by an approval card.' },
    tool:    { name: 'Tool / escalate', lit: '#5ba8a0', glyph: '⚙', desc: 'A tool call or a Bash security escalation (allow / hold / deny).' },
    guard:   { name: 'Guard / QA',      varn: '--amber', glyph: '⛨', desc: 'A QA review or an egress guard holding a draft before it ships.' },
    handoff: { name: 'Handoff event',   lit: '#a17fc0', glyph: '⇄', desc: 'A typed cross-seat signal: dispatch, build-done, invoice-request, nudge.' },
    state:   { name: 'State change',    varn: '--dim', glyph: '◈', desc: 'A governing transition: spend alert, tripwire, safe-mode, recover.' },
  };
  const CLASS_KEYS = Object.keys(CLASSES);

  /* =============================== the roster =============================== */
  const CLIENTS = [
    { id: 'brickwise', label: 'Brickwise', who: 'Ohad' },
    { id: 'justin', label: 'Justin', who: 'Justin' },
    { id: 'gsa', label: 'GSA', who: 'GSA' },
    { id: 'acta', label: 'Acta', who: 'Acta' },
    { id: 'alon', label: 'Alon', who: 'Alon' },
    { id: 'settld', label: 'Settld', who: 'Settld' },
    { id: 'airtree', label: 'Airtree', who: 'Airtree' },
    { id: 'shalhevet', label: 'Shalhevet', who: 'Sharon' },
  ];
  const ROLE = {
    human:   { ring: 'human',  tone: '--accent',  lit: null },
    general: { ring: 'lead',   lit: '#5b9bd5' },
    ceo:     { ring: 'lead',   tone: '--amber' },
    coo:     { ring: 'lead',   tone: '--green' },
    cfo:     { ring: 'lead',   lit: '#a17fc0' },
    qa:      { ring: 'lead',   tone: '--red' },
    account: { ring: 'acct',   tone: '--green' },
    builder: { ring: 'build',  lit: '#5ba8a0' },
    client:  { ring: 'client', tone: '--faint' },
  };

  const nodes = [];
  const N = {};
  function addNode(o) {
    const n = Object.assign({ x: 0, y: 0, r: 14, actLevel: 0, working: false, turn: null,
      turns: 0, events: 0, lastKind: null, lastText: 'idle', pulse: 0, appear: 0 }, o);
    nodes.push(n); N[n.id] = n; return n;
  }
  addNode({ id: 'oren', short: 'O', name: 'Oren', role: 'human', sub: 'Director', desc: 'Director & founder. The human Cleo serves. Every binding action — a client send, a spend, a ship — routes here for the tap.' });
  addNode({ id: 'elad', short: 'E', name: 'Elad', role: 'human', sub: 'Director', desc: 'Director & founder. Drives #hq. Sets the follow-up cadence and the money/scope guardrails the seats obey.' });
  addNode({ id: 'general', short: 'HQ', name: 'General', role: 'general', sub: '#hq · the one face', desc: 'The default face at #hq — full-Cleo. Delegates to the specialist seats and dispatches builds. Receives every build-done; never authors one.' });
  addNode({ id: 'ceo', short: 'CEO', name: 'CEO', role: 'ceo', sub: 'Strategy', desc: 'Strategy & portfolio vigilance. Runs the 07:00 board review; proposes ≤3 decision cards/day. Never contacts a client, spends, or reads code.' });
  addNode({ id: 'coo', short: 'COO', name: 'COO', role: 'coo', sub: '#ops · founder ops', desc: 'The Account persona turned inward — the founders are its one client. Turns their asks into delegated builds or ops actions, then closes the loop.' });
  addNode({ id: 'cfo', short: 'CFO', name: 'CFO', role: 'cfo', sub: 'Finance', desc: "Owns the money end-to-end: invoices, collections, GST/BAS, founder payouts. Drafts everything — moves nothing without a director's tap." });
  addNode({ id: 'qa', short: 'QA', name: 'QA', role: 'qa', sub: 'Adversarial audit', desc: 'Hostile security reviewer between a build and its delivery. Applies a fixed ten-dimension rubric; tries to refute every control before it ships.' });
  for (const c of CLIENTS) {
    addNode({ id: `acct:${c.id}`, short: c.label.slice(0, 2).toUpperCase(), name: c.label, role: 'account', client: c.id, sub: `Account · #${c.id}`,
      desc: `Client account manager — the partner in ${c.label}'s room. Full autonomy after a director's "go"; escalates only money & scope. Owns the relationship, never the code.` });
    addNode({ id: `build:${c.id}`, short: '⌘', name: c.label, role: 'builder', client: c.id, sub: `Builder · #${c.id}-build`,
      desc: `Builder for ${c.label} — ships the app behind Cleo's one face. Has no client-comms tools; hands finished work back as a build-done event through QA.` });
    addNode({ id: `client:${c.id}`, short: c.who.slice(0, 1), name: c.who, role: 'client', client: c.id, sub: `Client · ${c.label}`,
      desc: `${c.label} — the client. Cleo reaches them only through gated comms (WhatsApp / email), and only after the approval card is tapped.` });
  }

  const edges = [];
  const edge = (a, b, kind) => edges.push({ a, b, kind });
  edge('elad', 'general', 'lead'); edge('oren', 'general', 'lead');
  edge('oren', 'ceo', 'lead'); edge('elad', 'coo', 'lead'); edge('oren', 'cfo', 'lead'); edge('elad', 'ceo', 'lead');
  edge('general', 'ceo', 'lead'); edge('general', 'coo', 'lead'); edge('general', 'cfo', 'lead');
  edge('coo', 'qa', 'lead'); edge('general', 'qa', 'lead');
  for (const c of CLIENTS) {
    edge('general', `acct:${c.id}`, 'lead');
    edge(`acct:${c.id}`, `build:${c.id}`, 'seat');
    edge(`acct:${c.id}`, `client:${c.id}`, 'client');
    edge(`build:${c.id}`, 'qa', 'seat');
    edge(`acct:${c.id}`, 'cfo', 'fin');
  }
  const edgeKey = new Map();
  for (const e of edges) { edgeKey.set(e.a + '|' + e.b, e); edgeKey.set(e.b + '|' + e.a, e); }

  /* =============================== DOM + styles =============================== */
  let root, cv, ctx, built = false;
  function injectStyles() {
    if (document.getElementById('obs-styles')) return;
    const css = `
#obs-modal{display:none;position:fixed;inset:0;z-index:950;background:rgba(0,0,0,.62);backdrop-filter:blur(4px);align-items:center;justify-content:center;}
#obs-modal.open{display:flex;}
#obs-shell{position:relative;width:min(1320px,96vw);height:min(90vh,900px);background:var(--bg);border:1px solid var(--border);border-radius:18px;overflow:hidden;display:grid;grid-template-columns:1fr 320px;grid-template-rows:auto 1fr auto;grid-template-areas:"bar bar" "stage rail" "ticker ticker";box-shadow:0 24px 80px rgba(0,0,0,.5);font-family:var(--font);}
#obs-bar{grid-area:bar;display:flex;align-items:center;gap:16px;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--panel);flex-wrap:wrap;}
#obs-brand{display:flex;align-items:center;gap:11px;}
#obs-brand .sig{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--accent);color:#fff;font-weight:800;font-size:16px;}
#obs-brand b{font-size:15px;font-weight:700;letter-spacing:-.2px;display:block;line-height:1.1;}
#obs-brand span{font-family:var(--mono);font-size:9px;letter-spacing:1.8px;text-transform:uppercase;color:var(--faint);}
.obs-badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--mono);font-size:10px;letter-spacing:1.2px;text-transform:uppercase;padding:4px 9px;border-radius:100px;border:1px solid var(--border);color:var(--dim);cursor:pointer;user-select:none;}
.obs-badge .d{width:7px;height:7px;border-radius:50%;background:currentColor;}
.obs-badge.live{color:var(--green);border-color:color-mix(in srgb,var(--green) 45%,transparent);background:color-mix(in srgb,var(--green) 12%,transparent);}
.obs-badge.live .d{animation:obs-beat 1.6s ease-in-out infinite;}
.obs-badge.demo{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 45%,transparent);background:color-mix(in srgb,var(--amber) 12%,transparent);}
@keyframes obs-beat{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.35;transform:scale(.65);}}
#obs-clock{font-family:var(--mono);font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums;}
#obs-stats{display:flex;margin-left:auto;}
.obs-stat{display:flex;flex-direction:column;padding:0 13px;border-left:1px solid var(--border);min-width:64px;}
.obs-stat:first-child{border-left:0;}
.obs-stat .k{font-family:var(--mono);font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--faint);}
.obs-stat .v{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.15;}
#obs-ctrls{display:flex;align-items:center;gap:7px;}
.obs-btn{font-family:var(--mono);font-size:11px;color:var(--dim);background:var(--elevated);border:1px solid var(--border);padding:6px 10px;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;}
.obs-btn:hover{color:var(--text);border-color:var(--accent);}
.obs-btn.on{background:var(--accent);border-color:var(--accent);color:#fff;}
.obs-btn.close{font-size:15px;padding:5px 9px;}
.obs-speed{display:inline-flex;align-items:center;gap:6px;}
.obs-speed label{font-family:var(--mono);font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);}
#obs-speed{width:78px;accent-color:var(--accent);}
#obs-stage{grid-area:stage;position:relative;overflow:hidden;background:radial-gradient(1100px 760px at 50% 42%,var(--panel),var(--bg) 72%);}
#obs-scene{position:absolute;inset:0;width:100%;height:100%;display:block;}
#obs-legend{position:absolute;left:14px;top:12px;background:color-mix(in srgb,var(--panel) 85%,transparent);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:12px;padding:10px 11px;width:184px;z-index:5;}
#obs-legend h4{margin:0 0 8px;font-family:var(--mono);font-size:8.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);display:flex;justify-content:space-between;font-weight:600;}
.obs-lg{display:flex;align-items:center;gap:8px;width:100%;padding:3px 5px;border:0;background:none;color:var(--dim);font-family:var(--font);font-size:12px;text-align:left;cursor:pointer;border-radius:7px;}
.obs-lg:hover{background:var(--elevated);}
.obs-lg.off{opacity:.34;}
.obs-lg .sw{width:10px;height:10px;border-radius:3px;flex:none;box-shadow:0 0 7px -1px currentColor;}
.obs-lg .nm{flex:1;color:var(--text);}
.obs-lg .ct{font-family:var(--mono);font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;}
#obs-legend .foot{margin-top:7px;padding-top:7px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--faint);line-height:1.5;}
#obs-focus{position:absolute;left:50%;top:12px;transform:translateX(-50%);display:none;align-items:center;gap:9px;background:color-mix(in srgb,var(--panel) 88%,transparent);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,var(--accent) 45%,var(--border));border-radius:100px;padding:5px 7px 5px 13px;font-size:12px;color:var(--text);z-index:6;}
#obs-focus.on{display:flex;}
#obs-focus b{font-weight:700;}
#obs-focus button{border:0;background:var(--elevated);color:var(--dim);width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;}
#obs-banner{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:none;max-width:80%;background:color-mix(in srgb,var(--amber) 14%,var(--panel));border:1px solid color-mix(in srgb,var(--amber) 45%,var(--border));border-radius:10px;padding:8px 13px;font-size:11.5px;color:var(--text);z-index:6;text-align:center;line-height:1.5;}
#obs-banner.on{display:block;}
#obs-banner code{font-family:var(--mono);font-size:11px;color:var(--amber);}
#obs-tip{position:absolute;z-index:20;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;width:250px;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.4);overflow:hidden;}
#obs-tip.on{opacity:1;transform:none;}
#obs-tip .th{display:flex;align-items:center;gap:9px;padding:11px 12px 9px;border-bottom:1px solid var(--border);}
#obs-tip .av{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:800;font-size:12px;color:#fff;}
#obs-tip .th b{font-size:13.5px;font-weight:700;display:block;line-height:1.15;}
#obs-tip .th span{font-family:var(--mono);font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--faint);}
#obs-tip .role{padding:9px 12px;font-size:11.5px;color:var(--dim);line-height:1.5;}
#obs-tip .st{display:flex;border-top:1px solid var(--border);}
#obs-tip .st div{flex:1;padding:8px 12px;border-left:1px solid var(--border);}
#obs-tip .st div:first-child{border-left:0;}
#obs-tip .st .k{font-family:var(--mono);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);}
#obs-tip .st .v{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;}
#obs-tip .now{padding:8px 12px;border-top:1px solid var(--border);background:var(--elevated);font-size:11px;display:flex;gap:7px;align-items:baseline;}
#obs-tip .now .lab{font-family:var(--mono);font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);flex:none;}
#obs-rail{grid-area:rail;background:var(--panel);border-left:1px solid var(--border);display:flex;flex-direction:column;min-height:0;}
#obs-rail .rh{padding:12px 15px 10px;border-bottom:1px solid var(--border);display:flex;align-items:baseline;justify-content:space-between;}
#obs-rail .rh b{font-size:13px;font-weight:700;}
#obs-rail .rh span{font-family:var(--mono);font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--faint);}
#obs-notes{padding:10px 13px 11px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:7px;max-height:55%;overflow-y:auto;}
#obs-notes[hidden]{display:none;}
#obs-notes .nh{display:flex;align-items:baseline;justify-content:space-between;gap:8px;}
#obs-notes .nh b{font-size:13px;}
#obs-notes .nh span,#obs-notes .nf{font-size:10.5px;color:var(--faint);}
#obs-notes .nt{border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:var(--bg);font-size:12px;line-height:1.5;}
#obs-notes .nt p{margin:0;white-space:pre-wrap;unicode-bidi:plaintext;}
#obs-notes .nt .nm{display:flex;gap:8px;align-items:center;margin-top:4px;font-size:10.5px;color:var(--faint);}
#obs-notes .nt .nm button{margin-left:auto;font:inherit;font-size:10.5px;background:none;border:1px solid var(--border);border-radius:6px;padding:1px 7px;cursor:pointer;color:var(--dim);}
#obs-notes .nt.refused{border-color:color-mix(in srgb,var(--red,#c0392b) 50%,var(--border));}
#obs-notes .nt.refused .st{color:var(--red,#c0392b);font-weight:600;}
#obs-notes .nt.removed{opacity:.55;}
#obs-notes textarea{width:100%;box-sizing:border-box;font:inherit;font-size:12px;border:1px solid var(--border);border-radius:8px;padding:7px 9px;background:var(--bg);color:var(--text);resize:vertical;}
#obs-notes .nr{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:11px;color:var(--dim);}
#obs-work{overflow-y:auto;padding:9px 11px 14px;flex:1;min-height:0;}
.obs-card{position:relative;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 11px 10px 12px;margin-bottom:8px;overflow:hidden;animation:obs-in .26s ease both;}
@keyframes obs-in{from{opacity:0;transform:translateY(5px);}to{opacity:1;transform:none;}}
.obs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--tone,#5b9bd5);}
.obs-card .ch{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.obs-card .av{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:9.5px;color:#fff;}
.obs-card .nm{flex:1;min-width:0;}
.obs-card .nm b{font-size:12px;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.obs-card .nm span{font-family:var(--mono);font-size:9px;color:var(--faint);}
.obs-card .tm{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums;font-weight:600;flex:none;color:var(--tone,#5b9bd5);}
.obs-card .tk{font-size:11px;color:var(--dim);line-height:1.4;margin-bottom:7px;}
.obs-card .cf{display:flex;align-items:center;gap:8px;}
.obs-card .pg{flex:1;height:3px;border-radius:2px;background:var(--border);overflow:hidden;}
.obs-card .pg i{display:block;height:100%;width:32%;background:var(--tone,#5b9bd5);border-radius:2px;animation:obs-sweep 1.5s linear infinite;}
@keyframes obs-sweep{from{transform:translateX(-120%);}to{transform:translateX(420%);}}
.obs-empty{color:var(--faint);font-size:12px;text-align:center;padding:38px 18px;line-height:1.6;}
.obs-empty .g{font-size:24px;display:block;margin-bottom:7px;opacity:.6;}
#obs-ticker{grid-area:ticker;background:var(--bg);border-top:1px solid var(--border);height:128px;display:flex;flex-direction:column;}
#obs-ticker .th{display:flex;align-items:center;gap:10px;padding:6px 15px;border-bottom:1px solid var(--border);}
#obs-ticker .th b{font-family:var(--mono);font-size:8.5px;letter-spacing:1.4px;text-transform:uppercase;color:var(--faint);}
#obs-ticker .th .src{margin-left:auto;font-family:var(--mono);font-size:9px;color:var(--faint);}
#obs-feed{overflow-y:auto;flex:1;padding:2px 0 5px;}
.obs-ev{display:grid;grid-template-columns:66px 13px 1fr auto;align-items:center;gap:9px;padding:2px 15px;border-left:2px solid transparent;animation:obs-evin .28s ease both;}
@keyframes obs-evin{from{opacity:0;transform:translateX(-5px);}to{opacity:1;transform:none;}}
.obs-ev:hover{background:var(--elevated);border-left-color:var(--dc);}
.obs-ev .t{font-family:var(--mono);font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;}
.obs-ev .d{width:8px;height:8px;border-radius:50%;background:var(--dc);}
.obs-ev .m{font-size:11.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.obs-ev .m .who{color:var(--text);font-weight:600;}
.obs-ev .m .ar{color:var(--faint);margin:0 4px;}
.obs-ev .m .sm{color:var(--dim);}
.obs-ev .kd{font-family:var(--mono);font-size:9px;color:var(--dc);}
.obs-ev.warn .m .sm{color:var(--amber);}
.obs-ev.err .m .sm{color:var(--red);}
@media (max-width:820px){#obs-shell{grid-template-columns:1fr;grid-template-rows:auto 52vh auto auto;grid-template-areas:"bar" "stage" "rail" "ticker";height:94vh;}#obs-rail{border-left:0;border-top:1px solid var(--border);max-height:230px;}}
@media (prefers-reduced-motion:reduce){#obs-modal *{animation-duration:.001ms!important;}}
`;
    const st = document.createElement('style');
    st.id = 'obs-styles'; st.textContent = css;
    document.head.appendChild(st);
  }

  function buildDom() {
    if (built) return;
    injectStyles();
    root = document.getElementById('obs-modal');
    if (!root) { root = document.createElement('div'); root.id = 'obs-modal'; document.body.appendChild(root); }
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Ops Observatory');
    root.innerHTML = `
<div id="obs-shell">
  <header id="obs-bar">
    <div id="obs-brand"><div class="sig">C</div><div><b>Ops Observatory</b><span>Cleo · flight recorder</span></div></div>
    <span class="obs-badge live" id="obs-mode" title="Live trace — elad-oren-trace"><span class="d"></span><span id="obs-mode-t">Live</span></span>
    <span id="obs-clock">--:--:--</span>
    <div id="obs-stats">
      <div class="obs-stat"><span class="k">On floor</span><span class="v" id="obs-s-active">0</span></div>
      <div class="obs-stat"><span class="k">Ev / min</span><span class="v" id="obs-s-rate">0</span></div>
      <div class="obs-stat"><span class="k">Handoffs</span><span class="v" id="obs-s-hand">0</span></div>
      <div class="obs-stat"><span class="k">Client sends</span><span class="v" id="obs-s-comms">0</span></div>
    </div>
    <div id="obs-ctrls">
      <button class="obs-btn" id="obs-pause" title="Pause / resume">❚❚</button>
      <button class="obs-btn close" id="obs-close" title="Close (Esc)">✕</button>
    </div>
  </header>
  <div id="obs-stage">
    <canvas id="obs-scene"></canvas>
    <div id="obs-legend"><h4><span>Interaction types</span><span id="obs-lg-total">0</span></h4><div id="obs-lg-rows"></div><div class="foot">Click a seat to focus its lineage.<br>Drag a seat to arrange the map — <a href="#" id="obs-reset">reset</a>.<br>Hover anything for detail.</div></div>
    <div id="obs-focus"><span>Focused on <b id="obs-focus-n"></b></span><button id="obs-focus-x" title="Clear">×</button></div>
    <div id="obs-banner"></div>
    <div id="obs-tip"></div>
  </div>
  <aside id="obs-rail"><div id="obs-notes" hidden><div class="nh"><b>Notes for <span id="obs-notes-n"></span></b><span>guidance only</span></div><div id="obs-notes-list"></div><textarea id="obs-notes-t" dir="auto" maxlength="400" rows="2" placeholder="Add a short note to this seat's prompt…"></textarea><div class="nr"><span id="obs-notes-m"></span><button class="obs-btn" id="obs-notes-add">Add note</button></div><div class="nf">A note is guidance for the next turn, no PR needed. A note that grants a permission, relaxes a gate, or names money, the release path, a secret or a file path is refused by code.</div></div><div class="rh"><b>On the floor now</b><span id="obs-rail-c">0 turns</span></div><div id="obs-work"><div class="obs-empty"><span class="g">◍</span>No active turns.<br>Waiting for the next signal…</div></div></aside>
  <div id="obs-ticker"><div class="th"><b>Telemetry stream</b><span class="src" id="obs-src">connecting…</span></div><div id="obs-feed"></div></div>
</div>`;
    cv = document.getElementById('obs-scene');
    ctx = cv.getContext('2d');
    wireUi();
    buildLegend();
    built = true;
  }

  const $ = (id) => document.getElementById(id);

  /* =============================== palette =============================== */
  let PAL = {};
  function readPalette() {
    const cs = getComputedStyle(document.body);
    const g = (v) => cs.getPropertyValue(v).trim() || '#888';
    PAL = {
      bg: g('--bg'), panel: g('--panel'), line: g('--border'), ink: g('--text'), dim: g('--dim'), faint: g('--faint'), accent: g('--accent'),
    };
    for (const k of CLASS_KEYS) { const c = CLASSES[k]; PAL[k] = c.lit || g(c.varn); }
    for (const id of Object.keys(N)) { const r = ROLE[N[id].role]; N[id]._tone = r.lit || g(r.tone); }
  }
  function hexA(hex, a) {
    hex = (hex || '#888').trim();
    if (hex.startsWith('rgb')) return hex.replace(/rgb\(([^)]+)\)/, `rgba($1,${a})`).replace(/rgba\(([^)]+),[^,]+,${a}\)/, '');
    hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16), gg = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r || 0},${gg || 0},${b || 0},${a})`;
  }
  const isDark = () => document.body.classList.contains('dark');

  /* =============================== layout =============================== */
  let W = 0, H = 0, CX = 0, CY = 0, DPR = 1;
  function layout() {
    const stage = $('obs-stage'); if (!stage) return;
    W = stage.clientWidth || 900; H = stage.clientHeight || 500;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    CX = W / 2; CY = H / 2 + Math.min(8, H * 0.02);
    const base = Math.min(W, H);
    const rLead = base * 0.205, rAcct = base * 0.325, rBuild = base * 0.405, rClient = base * 0.475;
    N.oren.x = CX - base * 0.052; N.oren.y = CY - base * 0.018; N.oren.r = 17;
    N.elad.x = CX + base * 0.052; N.elad.y = CY - base * 0.018; N.elad.r = 17;
    const lead = [['general', -90], ['ceo', -32], ['cfo', 26], ['coo', -148], ['qa', 150]];
    for (const [id, deg] of lead) { const a = deg * Math.PI / 180; N[id].x = CX + Math.cos(a) * rLead; N[id].y = CY + Math.sin(a) * rLead * 0.92; N[id].r = 16; }
    const n = CLIENTS.length;
    for (let i = 0; i < n; i++) {
      const c = CLIENTS[i]; const a = (-90 + (i + 0.5) * (360 / n)) * Math.PI / 180;
      N[`acct:${c.id}`].x = CX + Math.cos(a) * rAcct; N[`acct:${c.id}`].y = CY + Math.sin(a) * rAcct * 0.94; N[`acct:${c.id}`].r = 13;
      N[`build:${c.id}`].x = CX + Math.cos(a) * rBuild; N[`build:${c.id}`].y = CY + Math.sin(a) * rBuild * 0.94; N[`build:${c.id}`].r = 11;
      N[`client:${c.id}`].x = CX + Math.cos(a) * rClient; N[`client:${c.id}`].y = CY + Math.sin(a) * rClient * 0.94; N[`client:${c.id}`].r = 9;
    }
    applyCustom();
  }
  // The directors' arrangement (Oren, 2 Sep: "I want to drag them into a shape that reads right" — then
  // "shared for both of us"). Positions are fractions of the stage so the shape survives a resize. Source of
  // truth is `elad-oren-config/layout.observatory` (director-writable, console-only — the brain never reads
  // it); the browser keeps a copy so the map opens in shape before Firestore answers and still works offline.
  // Reset puts the rings back for both. This is the ONE thing the Observatory writes.
  const LAYOUT_KEY = 'cleo-obs-layout';
  let custom = {}, layoutUnsub = null, dragId = null;
  try { custom = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {}; } catch { custom = {}; }
  function saveCustom() {
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(custom)); } catch { /* private mode */ }
    const d = getDb(); if (!d) return;
    setDoc(doc(d, 'elad-oren-config', 'layout'), { observatory: custom, updatedAt: serverTimestamp() }, { merge: false })
      .catch((e) => showBanner(/permission/i.test(String(e?.message)) ? 'Layout saved on this browser only — the shared-layout rule is not deployed yet.' : 'Layout saved on this browser only — ' + String(e?.message || e).slice(0, 80)));
  }
  function applyCustom() {
    for (const [id, p] of Object.entries(custom)) {
      const nd = N[id]; if (!nd || !p || !isFinite(p.fx) || !isFinite(p.fy) || id === dragId) continue;
      nd.x = clamp(p.fx, 0.03, 0.97) * W; nd.y = clamp(p.fy, 0.05, 0.95) * H;
    }
  }
  function resetLayout() { custom = {}; saveCustom(); layout(); }
  function watchLayout() {
    unwatchLayout();
    const d = getDb(); if (!d) return;
    try {
      layoutUnsub = onSnapshot(doc(d, 'elad-oren-config', 'layout'), (snap) => {
        const o = snap.exists() ? snap.data()?.observatory : null;
        if (!o || typeof o !== 'object') return;
        custom = o; try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(custom)); } catch { /* private mode */ }
        layout();
      }, () => { /* no read yet (rule not deployed) — the browser copy stands */ });
    } catch { /* offline */ }
  }
  function unwatchLayout() { if (layoutUnsub) { try { layoutUnsub(); } catch { /* already gone */ } layoutUnsub = null; } }

  /* =============================== particles =============================== */
  const particles = [];
  function ctrlPoint(x1, y1, x2, y2) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const bias = ((mx - CX) * nx + (my - CY) * ny) < 0 ? -1 : 1;
    const off = clamp(len * 0.16, 8, 74) * bias;
    return { cx: mx + nx * off, cy: my + ny * off };
  }
  const bez = (p0, p1, c, t) => { const u = 1 - t; return u * u * p0 + 2 * u * t * c + t * t * p1; };
  function spawnParticle(from, to, cls) {
    const A = N[from], B = N[to]; if (!A || !B) return;
    if (particles.length > 240) particles.splice(0, particles.length - 240);
    const { cx, cy } = ctrlPoint(A.x, A.y, B.x, B.y);
    particles.push({ from, to, cls, x1: A.x, y1: A.y, x2: B.x, y2: B.y, cx, cy, t: 0,
      speed: reduceMotion ? 0.09 : rnd(0.010, 0.017), r: cls === 'state' ? 4.2 : cls === 'comms' ? 4.0 : 3.4 });
  }

  /* =============================== render =============================== */
  let hoverId = null, focusId = null, paused = false;
  const glow = () => (isDark() ? 1 : 0.4);
  const nodeDim = (id) => focusId && id !== focusId && !edgeKey.has(id + '|' + focusId);

  function draw(ts) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    for (const e of edges) {
      const A = N[e.a], B = N[e.b]; if (!A || !B) continue;
      const { cx, cy } = ctrlPoint(A.x, A.y, B.x, B.y);
      const focused = focusId && (e.a === focusId || e.b === focusId);
      const dim = focusId && !focused;
      let col, w;
      if (focused) { col = hexA(PAL.accent, 0.55); w = 1.4; }
      else if (dim) { col = hexA(PAL.line, 0.35); w = 0.7; }
      else { col = hexA(PAL.line, e.kind === 'lead' ? 0.9 : 0.6); w = e.kind === 'lead' ? 1 : 0.8; }
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(cx, cy, B.x, B.y);
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
    }
    const gl = glow();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (!paused) p.t += p.speed;
      if (p.t >= 1) { particles.splice(i, 1); continue; }
      const col = PAL[p.cls] || PAL.accent;
      const steps = reduceMotion ? 1 : 7;
      for (let s = 0; s < steps; s++) {
        const tt = clamp(p.t - s * 0.028, 0, 1);
        const x = bez(p.x1, p.x2, p.cx, tt), y = bez(p.y1, p.y2, p.cy, tt);
        const a = (1 - s / steps) * 0.9;
        ctx.beginPath(); ctx.arc(x, y, p.r * (1 - s / steps * 0.6), 0, TAU); ctx.fillStyle = hexA(col, a * 0.5); ctx.fill();
      }
      const x = bez(p.x1, p.x2, p.cx, p.t), y = bez(p.y1, p.y2, p.cy, p.t);
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 12 * gl;
      ctx.beginPath(); ctx.arc(x, y, p.r, 0, TAU); ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(x, y, p.r * 0.4, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      if (p.t > 0.965 && !p._p) { p._p = true; if (N[p.to]) N[p.to].pulse = 1; }
    }
    for (const nd of nodes) {
      if (nd.appear < 1 && !paused) nd.appear = clamp(nd.appear + 0.05, 0, 1);
      const ap = easeOut(nd.appear);
      const dim = nodeDim(nd.id);
      const tone = nd._tone || PAL.accent;
      const isHuman = nd.role === 'human';
      const breathe = reduceMotion ? 1 : (nd.working ? Math.sin(ts / 380 + nd.x) * 0.1 + 1 : 1);
      const R = nd.r * ap * breathe;
      if (!paused) { nd.actLevel = Math.max(0, nd.actLevel - 0.006); nd.pulse = Math.max(0, nd.pulse - 0.03); }
      ctx.globalAlpha = dim ? 0.26 : 1;
      const heat = Math.max(nd.actLevel, nd.working ? 0.55 : 0);
      if (heat > 0.02) {
        const g = ctx.createRadialGradient(nd.x, nd.y, R * 0.6, nd.x, nd.y, R + 26 * heat);
        g.addColorStop(0, hexA(tone, 0.3 * heat * gl)); g.addColorStop(1, hexA(tone, 0));
        ctx.beginPath(); ctx.arc(nd.x, nd.y, R + 26 * heat, 0, TAU); ctx.fillStyle = g; ctx.fill();
      }
      if (nd.pulse > 0.02) { ctx.beginPath(); ctx.arc(nd.x, nd.y, R + (1 - nd.pulse) * 16, 0, TAU); ctx.strokeStyle = hexA(tone, nd.pulse * 0.6); ctx.lineWidth = 1.5; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(nd.x, nd.y, R, 0, TAU);
      ctx.fillStyle = isHuman ? tone : hexA(tone, nd.working ? 0.95 : 0.16);
      ctx.fill();
      ctx.lineWidth = nd.working ? 2 : 1.2;
      ctx.strokeStyle = nd.working ? tone : (hoverId === nd.id ? PAL.ink : hexA(tone, 0.7));
      ctx.stroke();
      if (nd.working && nd.turn) {
        if (nd.turn.live) { // indeterminate spinner for a live turn (unknown duration)
          const a0 = (ts / 700) % TAU;
          ctx.beginPath(); ctx.arc(nd.x, nd.y, R + 5, a0, a0 + TAU * 0.7); ctx.strokeStyle = tone; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
        } else {
          const frac = clamp((simMs - nd.turn.start) / nd.turn.dur, 0, 1);
          ctx.beginPath(); ctx.arc(nd.x, nd.y, R + 5, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.strokeStyle = tone; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
        }
      }
      ctx.fillStyle = isHuman ? '#fff' : (nd.working ? (isDark() ? '#0c0e14' : '#fff') : tone);
      ctx.font = `700 ${clamp(R * 0.72, 8, 12)}px var(--font, sans-serif)`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (R > 8) ctx.fillText(nd.short, nd.x, nd.y + 0.5);
      const showName = nd.role === 'human' || ROLE[nd.role].ring === 'lead' || hoverId === nd.id || (focusId && !dim);
      if (showName && !dim) {
        ctx.fillStyle = PAL.dim; ctx.globalAlpha = 0.92;
        ctx.font = '600 10px var(--font, sans-serif)';
        ctx.fillText(nd.name, nd.x, nd.y + R + 11);
      }
      ctx.globalAlpha = 1;
    }
  }
  let rafId = null;
  function frame(ts) { draw(ts); rafId = requestAnimationFrame(frame); }

  /* =============================== clocks =============================== */
  let simEpoch = Date.now(), simMs = 0;
  const nowMs = () => simMs;
  const simTime = () => simEpoch + simMs;

  /* =============================== event bus =============================== */
  let counts = Object.fromEntries(CLASS_KEYS.map(k => [k, 0]));
  let totalEvents = 0, handoffCount = 0, commsCount = 0;
  const rateStamps = [];
  const activeTurns = new Map();
  const enabled = Object.fromEntries(CLASS_KEYS.map(k => [k, true]));

  function labelOf(id) {
    const nn = N[id]; if (!nn) return id;
    if (nn.role === 'client') return nn.name;
    if (nn.role === 'account' || nn.role === 'builder') return `${nn.name} ${cap(nn.role)}`;
    return nn.name;
  }
  function emit(ev) {
    totalEvents++; counts[ev.cls] = (counts[ev.cls] || 0) + 1;
    if (ev.cls === 'handoff') handoffCount++;
    if (ev.cls === 'comms' && ev.lvl !== 'warn' && ev.lvl !== 'error') commsCount++;
    rateStamps.push(Date.now());
    const from = N[ev.from], to = N[ev.to];
    if (from) { from.events++; from.actLevel = Math.min(1, from.actLevel + 0.5); from.lastKind = ev.cls; from.lastText = ev.text || from.lastText; }
    if (to) to.events++;
    if (enabled[ev.cls] && from && to && ev.from !== ev.to) spawnParticle(ev.from, ev.to, ev.cls);
    else if (from) from.pulse = 1;
    pushFeed(ev);
    refreshStats();
  }

  /* turns */
  function startTurn(seatId, task, durMs, live) {
    const seat = N[seatId]; if (!seat) return null;
    if (seat.working && seat.turn) endTurn(seat.turn);
    const t = { id: 't' + (Math.random() * 1e6 | 0), seat: seatId, task, start: live ? Date.now() : nowMs(), dur: durMs, live: !!live, cost: 0 };
    seat.working = true; seat.turn = t; seat.turns++; seat.actLevel = 1;
    activeTurns.set(t.id, t); renderWork();
    return t;
  }
  function endTurn(t, cost) {
    if (!t) return;
    const seat = N[t.seat];
    if (seat) { seat.working = false; seat.turn = null; }
    activeTurns.delete(t.id); renderWork();
  }
  const turnElapsedS = (t) => Math.max(0, ((t.live ? Date.now() : nowMs()) - t.start) / 1000);

  /* =============================== stats / ui =============================== */
  function refreshStats() {
    if (!built) return;
    $('obs-s-active').textContent = activeTurns.size;
    $('obs-rail-c').textContent = activeTurns.size + (activeTurns.size === 1 ? ' turn' : ' turns');
    const cut = Date.now() - 60000; while (rateStamps.length && rateStamps[0] < cut) rateStamps.shift();
    $('obs-s-rate').textContent = rateStamps.length;
    $('obs-s-hand').textContent = handoffCount;
    $('obs-s-comms').textContent = commsCount;
    for (const k of CLASS_KEYS) { const el = $('obs-ct-' + k); if (el) el.textContent = counts[k] || 0; }
    $('obs-lg-total').textContent = totalEvents;
  }
  function updateClock() {
    if (!built) return;
    const d = new Date(simTime()), p = (n) => String(n).padStart(2, '0');
    $('obs-clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    for (const t of activeTurns.values()) {
      const el = $('obs-tm-' + t.id);
      if (el) { const s = turnElapsedS(t); el.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
    }
  }
  const MAXFEED = 60;
  function pushFeed(ev) {
    if (!enabled[ev.cls] || !built) return;
    const feed = $('obs-feed');
    const row = document.createElement('div');
    row.className = 'obs-ev ' + (ev.lvl === 'error' ? 'err' : ev.lvl === 'warn' ? 'warn' : '');
    row.style.setProperty('--dc', PAL[ev.cls] || PAL.accent);
    const d = new Date(ev.ts || simTime()), p = (n) => String(n).padStart(2, '0');
    const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const self = ev.from === ev.to;
    const route = self
      ? `<span class="who">${esc(labelOf(ev.from))}</span> <span class="sm">${esc(ev.text || CLASSES[ev.cls].name)}</span>`
      : `<span class="who">${esc(labelOf(ev.from))}</span><span class="ar">→</span><span class="who">${esc(labelOf(ev.to))}</span> <span class="sm">${esc(ev.text || '')}</span>`;
    row.innerHTML = `<span class="t">${time}</span><span class="d"></span><span class="m">${route}</span><span class="kd">${esc(ev.kind || ev.cls)}</span>`;
    if (!self) row.addEventListener('mouseenter', () => spawnParticle(ev.from, ev.to, ev.cls));
    feed.prepend(row);
    while (feed.children.length > MAXFEED) feed.lastChild.remove();
  }
  function renderWork() {
    if (!built) return;
    const wl = $('obs-work');
    const list = [...activeTurns.values()].sort((a, b) => a.start - b.start);
    if (!list.length) { wl.innerHTML = `<div class="obs-empty"><span class="g">◍</span>No active turns.<br>Waiting for the next signal…</div>`; refreshStats(); return; }
    wl.innerHTML = '';
    for (const t of list) {
      const seat = N[t.seat]; const tone = seat._tone || '#5b9bd5';
      const card = document.createElement('div'); card.className = 'obs-card'; card.style.setProperty('--tone', tone);
      card.innerHTML = `<div class="ch"><div class="av" style="background:${tone}">${esc(seat.short)}</div>`
        + `<div class="nm"><b>${esc(labelOf(t.seat))}</b><span>${esc(seat.sub)}</span></div>`
        + `<div class="tm" id="obs-tm-${t.id}">0:00</div></div>`
        + `<div class="tk">${esc(t.task)}</div>`
        + `<div class="cf"><span class="pg"><i></i></span></div>`;
      wl.appendChild(card);
    }
    refreshStats();
  }
  function buildLegend() {
    const wrap = $('obs-lg-rows'); wrap.innerHTML = '';
    for (const k of CLASS_KEYS) {
      const c = CLASSES[k];
      const b = document.createElement('button'); b.className = 'obs-lg'; b.title = c.desc;
      b.innerHTML = `<span class="sw" style="background:${PAL[k] || '#888'};color:${PAL[k] || '#888'}"></span><span class="nm">${c.name}</span><span class="ct" id="obs-ct-${k}">0</span>`;
      b.addEventListener('click', () => { enabled[k] = !enabled[k]; b.classList.toggle('off', !enabled[k]); });
      wrap.appendChild(b);
    }
  }

  /* =============================== hover / focus =============================== */
  function nodeAt(mx, my) { let best = null, bd = 1e9; for (const nd of nodes) { const d = Math.hypot(mx - nd.x, my - nd.y); if (d < nd.r + 7 && d < bd) { bd = d; best = nd; } } return best; }
  function showTip(nd, cx, cy) {
    const tip = $('obs-tip'); const tone = nd._tone || PAL.accent;
    const status = nd.working ? nd.lastText : (nd.lastKind ? `last: ${CLASSES[nd.lastKind]?.name || nd.lastKind}` : 'idle');
    tip.innerHTML = `<div class="th"><div class="av" style="background:${tone}">${esc(nd.short)}</div>`
      + `<div><b>${esc(nd.client ? labelOf(nd.id) : nd.name)}</b><span>${esc(nd.sub)}</span></div></div>`
      + `<div class="role">${esc(nd.desc)}</div>`
      + `<div class="st"><div><div class="k">Turns</div><div class="v">${nd.turns}</div></div>`
      + `<div><div class="k">Signals</div><div class="v">${nd.events}</div></div>`
      + `<div><div class="k">Status</div><div class="v" style="font-size:11px;color:${nd.working ? tone : 'var(--faint)'}">${nd.working ? 'WORKING' : 'IDLE'}</div></div></div>`
      + `<div class="now"><span class="lab">Now</span><span>${esc(status)}</span></div>`;
    tip.classList.add('on');
    const rect = root.getBoundingClientRect();
    const tw = 250, th = tip.offsetHeight || 180;
    let x = cx - rect.left + 16, y = cy - rect.top - 10;
    if (x + tw > root.clientWidth - 10) x = cx - rect.left - tw - 16;
    if (y + th > root.clientHeight - 10) y = root.clientHeight - th - 10;
    if (y < 10) y = 10;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  const hideTip = () => $('obs-tip').classList.remove('on');
  function updateFocus() {
    const fn = $('obs-focus');
    if (focusId) { fn.classList.add('on'); $('obs-focus-n').textContent = labelOf(focusId); }
    else fn.classList.remove('on');
    renderNotes();
  }

  /* =============================== agent notes (ADR-0265) =============================== */
  // A director's short guidance on one seat, read by the kernel into that seat's next turns (guidance only; the
  // kernel refuses by code any note that grants, relaxes a gate, or names money/release/secrets/paths, and stamps
  // the reason back here). firestore.rules binds `by` to the signed-in director and `at` to the server time;
  // nothing deletes a note, so the list below is also the history of who changed a seat's guidance and when.
  let notes = [], notesUnsub = null;
  const NOTE_SEATS = new Set(['general', 'ceo', 'coo', 'cfo', 'qa']);
  function seatKey(id) {
    if (!id) return null;
    if (NOTE_SEATS.has(id)) return id;
    if (id.startsWith('acct:')) return 'account:' + id.slice(5);
    if (id.startsWith('build:')) return 'builder';
    return null;
  }
  function watchNotes() {
    unwatchNotes();
    const d = getDb(); if (!d) return;
    try {
      notesUnsub = onSnapshot(query(collection(d, 'elad-oren-config', 'agentNotes', 'items'), orderBy('at', 'desc'), limit(200)), (snap) => {
        notes = snap.docs.map((x) => ({ id: x.id, ...x.data() }));
        renderNotes();
      }, () => { notes = []; renderNotes('Notes are not readable yet (the rule is not deployed).'); });
    } catch { /* offline */ }
  }
  function unwatchNotes() { if (notesUnsub) { try { notesUnsub(); } catch { /* gone */ } notesUnsub = null; } }
  function noteWhen(n) { const ms = n.at?.toMillis?.(); return ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'saving…'; }
  function renderNotes(msg) {
    const box = $('obs-notes'); if (!box) return;
    const key = seatKey(focusId);
    box.hidden = !key;
    if (!key) return;
    $('obs-notes-n').textContent = labelOf(focusId);
    const keys = key.startsWith('account:') ? [key, 'account'] : [key];
    const mine = notes.filter((n) => keys.includes(n.seat));
    $('obs-notes-list').innerHTML = mine.length ? mine.map((n) =>
      `<div class="nt ${esc(n.state)}"><p dir="auto">${esc(n.text)}</p><div class="nm"><span>${esc(String(n.by || '').split('@')[0])} · ${esc(noteWhen(n))}${n.seat === 'account' ? ' · every account' : ''}</span>`
      + (n.state === 'refused' ? `<span class="st">Refused: ${esc(n.refusedReason || 'by the check')}</span>` : n.state === 'removed' ? '<span>Removed</span>' : '')
      + (n.state === 'active' ? `<button data-rm="${esc(n.id)}">Remove</button>` : '') + '</div></div>').join('')
      : '<div class="nf">No notes on this seat yet.</div>';
    if (msg !== undefined) $('obs-notes-m').textContent = msg;
  }
  async function addNote() {
    const key = seatKey(focusId); const t = $('obs-notes-t'); const text = String(t.value || '').trim();
    if (!key || !text) return;
    const d = getDb(); const email = (() => { try { return getAuth(getApp()).currentUser?.email || ''; } catch { return ''; } })();
    if (!d || !email) { renderNotes('Sign in first.'); return; }
    $('obs-notes-add').disabled = true;
    try {
      await addDoc(collection(d, 'elad-oren-config', 'agentNotes', 'items'), { seat: key, text, by: email, at: serverTimestamp(), state: 'active' });
      t.value = ''; renderNotes('Saved. The check runs on the next turn anywhere; a refusal shows here.');
    } catch (e) { renderNotes('Not saved: ' + String(e?.message || e).slice(0, 90)); }
    $('obs-notes-add').disabled = false;
  }
  async function removeNote(id) {
    const d = getDb(); const email = (() => { try { return getAuth(getApp()).currentUser?.email || ''; } catch { return ''; } })();
    if (!d || !email) return;
    try { await updateDoc(doc(d, 'elad-oren-config', 'agentNotes', 'items', id), { state: 'removed', removedBy: email, removedAt: serverTimestamp() }); renderNotes('Removed.'); }
    catch (e) { renderNotes('Not removed: ' + String(e?.message || e).slice(0, 90)); }
  }

  /* =============================== live feed (elad-oren-trace) =============================== */
  const ROOM_PERSONA = { hq: 'general', strategy: 'ceo', coo: 'coo', cfo: 'cfo',
    brickwise: 'acct:brickwise', justin: 'acct:justin', gsa: 'acct:gsa', acta: 'acct:acta', alon: 'acct:alon', settld: 'acct:settld', airtree: 'acct:airtree', shalhevet: 'acct:shalhevet' };
  const OPS_CLASS = {
    wa: 'comms', email: 'comms', 'gate-tool': 'comms', 'gate-cross-tenant-block': 'comms', 'gate-decline-stop': 'comms', 'attachment-refused': 'comms',
    session: 'turn', 'turn-stream-end': 'turn', coalesce: 'turn', 'batch-pickup': 'turn', 'turn-cancel': 'turn',
    'events.emit': 'handoff', 'events.injected': 'handoff', 'dispatch-build': 'handoff', 'delegation.dispatch': 'handoff', 'preview-push': 'handoff',
    'prod-ship-decided': 'handoff', 'prod-ship-push': 'handoff', 'prod-ship-pr': 'handoff', 'git-push': 'handoff',
    'bash-deny': 'tool', 'consequence-allow': 'tool', 'consequence-hold': 'tool', 'bash-escalate-failclosed': 'tool', 'read-tool': 'tool', 'web-search-blocked': 'tool', writeblock: 'tool', 'memory.write': 'tool',
    'qa-review': 'guard', 'qa-review-pass': 'guard', 'qa-review-rework': 'guard', 'egress-safe-fallback': 'guard', 'egress-superseded': 'guard',
    tripwire: 'state', 'tripwire-drift': 'state', control: 'state', 'spend-alert': 'state', boot: 'state', recover: 'state', 'supervisor-restart': 'state', 'heal-worktree': 'state', lease: 'state', 'lease-renew': 'state', 'floor-grace': 'state', calendar: 'state', notify: 'msg',
  };
  const pmap = (p) => (!p ? null : (N[p] ? p : (N['acct:' + p] ? 'acct:' + p : (N['build:' + p] ? 'build:' + p : null))));
  const traceTs = (e) => typeof e?.ts === 'number' ? e.ts : (e?.ts?.toMillis?.() || Date.parse(e?.iso || '') || Date.now());

  function mapRow(e) {
    const rawEvent = e.event || null;
    const kind = e.kind || (rawEvent ? 'ops.' + rawEvent : null);
    if (!kind) return null;
    const base = kind.split('.')[0];
    const opsName = kind.startsWith('ops.') ? kind.slice(4) : null;
    let cls = CLASS_KEYS.includes(e.cls) ? e.cls
      : CLASSES[base] ? base
        : (opsName && OPS_CLASS[opsName]) || (rawEvent && OPS_CLASS[rawEvent]) || 'state';
    const room = e.roomId || e.room || null;
    const isClientRoom = !!(room && CLIENTS.some(c => c.id === room));
    const bare = room ? room.replace(/-build$/, '') : null;
    const isBuildRoom = room && /-build$/.test(room) && CLIENTS.some(c => c.id === bare);
    const seat = isBuildRoom ? 'build:' + bare : isClientRoom ? 'acct:' + room
      : (room && ROOM_PERSONA[room]) ? ROOM_PERSONA[room]
        : (e.persona && pmap(e.persona)) ? pmap(e.persona) : 'general';
    const d = e.data || {};
    let from = seat, to = seat;
    if (cls === 'handoff') { from = pmap(d.from) || seat; to = pmap(d.to) || 'general'; if (from === to && seat !== 'general') to = 'general'; }
    else if (cls === 'comms') { if (isClientRoom) { from = 'client:' + room; to = 'acct:' + room; } else { cls = 'msg'; from = 'elad'; to = seat; } }
    else if (cls === 'msg') { from = 'elad'; to = seat; }
    const text = e.text || e.msg || d.status || d.tool || e.reason || (d.reason ? 'reason: ' + d.reason : null) || CLASSES[cls].name;
    return { cls, kind: String(kind).slice(0, 28), from, to, text, lvl: e.lvl || e.level || 'info', ts: traceTs(e), turnId: e.turnId || null, seat, room, data: d };
  }

  // apply a mapped live event: emit + maintain "who's working" from turn.* rows
  function applyLive(m) {
    if (m.kind === 'turn.session' || m.kind === 'ops.session' || m.kind === 'turn.coalesced') {
      const seat = N[m.seat];
      if (seat && !seat.working) startTurn(m.seat, seat.role === 'builder' ? 'building…' : seat.role === 'ceo' ? 'strategy turn' : seat.role === 'cfo' ? 'finance turn' : 'working a turn', 0, true);
    }
    if (m.kind === 'turn.stream-end' || m.kind === 'ops.turn-stream-end') {
      const seat = N[m.seat]; if (seat && seat.turn) endTurn(seat.turn);
    }
    emit(m);
  }

  let unsub = null, liveCount = 0, firstSnap = false, fallbackTimer = null;
  // The observatory renders LIVE data only (P4b, ADR-0049): the demo/model simulation (mode==='demo', the scenario
  // engine, pumpTimers, nextScenario, toDemo) was DELETED. When the trace sink is unavailable or quiet, the map
  // simply stays empty behind a banner that explains how to enable the feed — never a synthesised "model" a viewer
  // could mistake for the real kernel.
  function subscribe() {
    unsubscribe();
    const d = getDb(); if (!d) { showBanner('Firestore unavailable — no live trace to show.'); return; }
    let q;
    try { q = query(collection(d, 'elad-oren-trace'), orderBy('ts', 'desc'), limit(120)); }
    catch (e) { showBanner('Trace query failed — no live trace to show.'); return; }
    firstSnap = false; liveCount = 0;
    unsub = onSnapshot(q, (snap) => {
      try {
        const fresh = [];
        snap.docChanges().forEach((ch) => { if (ch.type === 'added' && !firstSnap) return; if (ch.type === 'removed') return; fresh.push(ch.doc.data() || {}); });
        // On the FIRST snapshot, seed the last ~30 rows oldest-first (a warm start).
        if (!firstSnap) {
          firstSnap = true;
          const seed = snap.docs.map(dd => dd.data()).reverse().slice(-30);
          for (const r of seed) { const m = mapRow(r); if (m) { liveCount++; applyLive(m); } }
        } else {
          fresh.sort((a, b) => traceTs(a) - traceTs(b));
          for (const r of fresh) { const m = mapRow(r); if (m) { liveCount++; applyLive(m); } }
        }
      } catch {}
    }, (err) => { showBanner('Trace stream unavailable (<code>' + esc(err?.code || 'error') + '</code>).'); });

    // If the sink is quiet after 4.5s, say so — but keep the live subscription open (rows may still arrive).
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      if (liveCount === 0) showBanner('No live trace yet. Enable <code>config.trace.firestore</code> for the live feed.');
    }, 4500);
  }
  function unsubscribe() { if (unsub) { try { unsub(); } catch {} unsub = null; } clearTimeout(fallbackTimer); }
  function showBanner(html) { const b = $('obs-banner'); b.innerHTML = html; b.classList.add('on'); }

  /* =============================== master loop =============================== */
  let lastLoop = Date.now(), loopTimer = null;
  function loop() {
    const now = Date.now(); let dt = now - lastLoop; lastLoop = now; if (dt > 250) dt = 250;
    if (!paused) simMs += dt; // live-only: the clock advances in real time; there is no demo scenario engine to pump
    updateClock();
    loopTimer = setTimeout(loop, 60);
  }

  /* =============================== wiring =============================== */
  function wireUi() {
    // Pointer handling: hover shows the tip; press-and-move drags a seat (saved on release); a press that
    // does not move is the old click — focus the seat's lineage. Works for mouse and touch alike.
    let drag = null; // { id, dx, dy, sx, sy, moved }
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = pos(e); const nd = nodeAt(p.x, p.y); if (!nd) return;
      drag = { id: nd.id, dx: nd.x - p.x, dy: nd.y - p.y, sx: p.x, sy: p.y, moved: false }; dragId = nd.id;
      try { cv.setPointerCapture(e.pointerId); } catch { /* not all browsers */ }
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (drag) {
        const nd = N[drag.id]; if (!nd) { drag = null; return; }
        if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 4) return;
        drag.moved = true; hideTip(); hoverId = null; cv.style.cursor = 'grabbing';
        nd.x = clamp(p.x + drag.dx, 12, W - 12); nd.y = clamp(p.y + drag.dy, 12, H - 12);
        e.preventDefault(); return;
      }
      const nd = nodeAt(p.x, p.y);
      hoverId = nd ? nd.id : null; cv.style.cursor = nd ? 'grab' : 'default';
      if (nd) showTip(nd, e.clientX, e.clientY); else hideTip();
    });
    const endDrag = () => {
      if (!drag) return;
      const nd = N[drag.id], moved = drag.moved; drag = null; dragId = null; cv.style.cursor = 'grab';
      if (!nd) return;
      if (moved) { custom[nd.id] = { fx: nd.x / W, fy: nd.y / H }; saveCustom(); }
      else { focusId = focusId === nd.id ? null : nd.id; updateFocus(); }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', () => { drag = null; dragId = null; cv.style.cursor = 'default'; });
    cv.addEventListener('mouseleave', () => { hoverId = null; hideTip(); });
    cv.addEventListener('click', (e) => { const p = pos(e); if (!nodeAt(p.x, p.y)) { focusId = null; updateFocus(); } });
    $('obs-focus-x').addEventListener('click', () => { focusId = null; updateFocus(); });
    $('obs-notes-add').addEventListener('click', addNote);
    $('obs-notes-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) removeNote(b.dataset.rm); });
    $('obs-reset').addEventListener('click', (e) => { e.preventDefault(); resetLayout(); });
    $('obs-pause').addEventListener('click', () => { paused = !paused; $('obs-pause').textContent = paused ? '▶' : '❚❚'; $('obs-pause').classList.toggle('on', paused); });
    $('obs-close').addEventListener('click', close);
    // (P4b) the live/model toggle and the speed slider were demo-only controls — removed with the simulation.
    root.addEventListener('click', (e) => { if (e.target.id === 'obs-modal') close(); });
    if (window.ResizeObserver) new ResizeObserver(() => layout()).observe($('obs-stage'));
  }

  // theme: re-read palette when the app toggles body.dark
  const themeObs = new MutationObserver(() => { if (built) { readPalette(); buildLegend(); } });

  /* =============================== open / close =============================== */
  let open_ = false;
  function open() {
    buildDom();
    readPalette(); buildLegend();
    root.classList.add('open');
    open_ = true;
    // reset transient state for a clean session
    focusId = null; paused = false; hoverId = null; updateFocus();
    $('obs-pause').textContent = '❚❚'; $('obs-pause').classList.remove('on'); $('obs-banner').classList.remove('on');
    simEpoch = Date.now(); simMs = 0; lastLoop = Date.now();
    layout(); requestAnimationFrame(layout);
    themeObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (!rafId) frame(0);
    if (!loopTimer) loop();
    $('obs-src').textContent = 'live · elad-oren-trace';
    subscribe();
    watchLayout();
    watchNotes();
    document.addEventListener('keydown', onKey);
  }
  function close() {
    open_ = false;
    root.classList.remove('open');
    unsubscribe(); unwatchLayout(); unwatchNotes();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    try { themeObs.disconnect(); } catch {}
    document.removeEventListener('keydown', onKey);
    hideTip();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  // wire the topbar button (added to index.html)
  function wireButton() {
    const btn = document.getElementById('obs-btn');
    if (btn && !btn._obsWired) { btn._obsWired = true; btn.addEventListener('click', () => { try { open(); } catch (err) { console.error('observatory', err); } }); }
    // ?obs=1 — the front door's Crew screen links straight here; give the console a beat to sign in first.
    if (new URLSearchParams(location.search).get('obs') === '1' && !wireButton._auto) {
      wireButton._auto = true;
      setTimeout(() => { try { open(); } catch (err) { console.error('observatory', err); } }, 1500);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireButton);
  else wireButton();

  window.CleoObservatory = { open, close };
})();

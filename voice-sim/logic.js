// Pure logic for the Elad & Oren app — no DOM, no Firebase, no globals.
// Everything here is unit-tested in tests/eo-logic.spec.mjs; keep it that way:
// new behavior lands here with a test, rendering stays in index.html.

export const STUCK_AFTER_MS = 45 * 60 * 1000; // 45 min of silence on a 'working' thread → stuck.
// Goal-3: a director message with NO turnState (the relay never picked it up) and no reply after this long is
// "not picked up" (red) — instead of silently fading to "done" at 15 min (the #brickwise HALT frozen-thread bug).
export const NOTPICKED_AFTER_MS = 3 * 60 * 1000;
// ADR-0218: a turn the Mac QUEUED but never started. 'queued' had no age limit, so a message parked behind
// full slots, or dropped from the in-memory queue, read "Pending" forever (24 Sep, #coo, 15:31 Sydney). Past
// this it is red 'stuck' — the Mac's own sweep re-runs an orphaned queued turn at the same age.
export const QUEUED_STUCK_AFTER_MS = 10 * 60 * 1000;
// ADR-0227: who writes as Cleo's own machinery rather than as a person — the brain, the kernel ('system') and the
// personas in config/personas.json. A post from one of these is a report, never a director's message waiting on a
// reply, so it can never read "Not picked up" (24 Sep: the overnight autopilot's "nothing to ship" note, posted as
// 'builder', sat red all day). 'Cleo' is deliberately NOT here: an event-wake is written as 'Cleo' and does need a turn.
export const AGENT_SENDERS = new Set(['brain', 'system', 'ceo', 'account', 'builder', 'general', 'qa', 'coo', 'cfo']);
// Cleo writing as herself: the kernel ('Cleo') and the Boss room posting into another room (a 'boss-note', an
// escalation's 'boss-answer'). Never a director: read by the relay it is done; unread it is red like any missed wake.
// (Oren, 26 Oct, #gsa: Boss's "📝 sync decisions" note read red, blinking "Not picked up" as if it waited on him.)
export const isCleoSelf = (m) => m?.from === 'Cleo' || m?.from === 'Boss';
// No real turn runs that long (the relay idle-aborts at ~10 min and hard-stops by ~20/65),
// so a 'working' thread silent this long is an orphaned turnState (turn ended/crashed without
// closing). Was 6 h — which let a dead thread show a climbing "Working" timer for hours.

// Blank-screen self-heal decision. The shell reveals #login / #app /
// #shabbat-screen via JS after load; if none becomes visible the copy is
// broken (almost always a stale cached shell after a deploy). Return true to
// clear caches + service worker and reload once. Capped at `maxTries` so a
// genuinely-down device can never fall into a reload loop. Mirrored by the
// inline watchdog in index.html (which must stay a classic script so it runs
// even when the app module itself fails to load).
export function shouldSelfHeal({ loginVisible, appVisible, shabbatVisible, tries, maxTries = 2 }) {
  if (loginVisible || appVisible || shabbatVisible) return false; // booted fine
  return (tries || 0) < maxTries;
}

// @mentions: pull the director names tagged in a message (case-insensitive),
// matched against the known director names. Returns canonical names, de-duped,
// in first-seen order. A name must follow whitespace/start (not mid-word/email).
export function extractMentions(text, names = []) {
  if (!text || !names.length) return [];
  const canon = new Map(names.map((n) => [n.toLowerCase(), n]));
  const out = [];
  const re = /(^|[^\p{L}\d_@])@([\p{L}\d_-]+)/gu;
  let m;
  while ((m = re.exec(text))) {
    const hit = canon.get(m[2].toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

// The first line of the director's message → task card title. Its width is the row's job (CSS ellipsis), not a word
// count: a 6-word cap cut "אוקיי קליאו לחבר של לאון הפנה…" with half the row empty (Oren, 12 Oct). TASK_TITLE_MAX only
// bounds a pasted wall of text. Strips file paths (e.g. @"/Users/elad/..." or /path/to/file) and URLs first, so titles
// reflect intent rather than incidental path tokens.
// PRESS_SKIP — the children of a message that act on their own tap: a tap on one of them does not toggle the
// message's ↩ / ⋮ bar (Oren, 20 Oct 2026: the "→ Routine" button "does nothing on press").
export const PRESS_SKIP = 'a, button, .msg-act, .msg-act-menu, .t-row-reply, .show-more, .copy-block-btn, .msg-brain-copy, '
  + '.flag-ack-btn, .qa-backdrop, .tap-copy, img[data-href]';
export const TASK_TITLE_MAX = 160;
export function taskTitle(text) {
  const line = (text || '').split('\n')[0].trim()
    .replace(/@?"[^"]*"|\S*\/\S+|\S+\.\S{2,4}(?=\s|$)/g, '')  // strip file paths, URLs, quoted paths
    .replace(/\s*[—–]\s*/g, ' ')                                 // normalize em/en dashes
    .replace(/\s{2,}/g, ' ').trim();
  return line.length > TASK_TITLE_MAX ? line.slice(0, TASK_TITLE_MAX - 1).trimEnd() + '…' : line;
}

// Group a chronological list of message entries ({ id, ref, m }) into items:
//   { type: 'task', trigger: entry, replies: [entry] }  — director request + its thread
//   { type: 'standalone', entry }                       — plain bubble
// Brain replies, cards, and threaded system notices attach to the task whose
// trigger id matches their threadId; adjacency is only a legacy fallback for
// messages written before the relay stamped threadId.
export function clusterMessages(entries) {
  const items = [];
  const byId = new Map(); // director msg id → its task
  let current = null;     // adjacency fallback
  for (const e of entries) {
    const m = e.m;
    // Cards carry no `from` — they come from the brain and belong to their thread
    const isBrainSide = m.from === 'brain' || m.type === 'question' || m.type === 'approval';
    // A live-activity progress strip (kernel/rooms.mjs writeActivity) is NOT a message and NEVER a task: it is a
    // single in-place "⚙️ Working — steps done" row that belongs INSIDE its working thread. Attach it to its
    // parent thread when the root is in this window; if the parent isn't clustered yet, DROP it (defer) rather
    // than let it root a "pending" task or leak out as a stray standalone bubble. The kernel re-writes the same
    // deterministic doc each step, so a deferred strip reappears the moment its thread is in view.
    if (m.kind === 'activity') {
      const parent = m.threadId && byId.get(m.threadId);
      if (parent) parent.replies.push(e);
      continue;
    }
    // Direct chat — never roots a task, always renders as a standalone bubble
    if (m.type === 'chat') { items.push({ type: 'standalone', entry: e }); continue; }
    if ((m.from === 'system' || m.type === 'align') && !m.threadId) {
      current = null; items.push({ type: 'standalone', entry: e }); continue;
    }
    // Media cards (podcast, video) always stand alone so renderPodcast/renderVideo fires.
    if (m.from === 'brain' && !m.threadId &&
        (m.text?.startsWith('🎙️ PODCAST') || m.text?.startsWith('🎬 VIDEO'))) {
      items.push({ type: 'standalone', entry: e }); continue;
    }
    if (!isBrainSide && m.from !== 'system') {
      // A director message that carries a threadId pointing at an existing task
      // is a REPLY that continues that thread — it must not root a new task.
      // (The relay routes the same threadId to the brain, so the turn resumes
      // on that task's root.) Without a matching threadId it roots a new task.
      const parent = m.threadId && byId.get(m.threadId);
      if (parent) { parent.replies.push(e); continue; }
      current = { type: 'task', trigger: e, replies: [] };
      byId.set(e.id, current);
      // A reply whose root is older than the window (the console reads the newest 150) continues that thread: it
      // stands in for the root, so the rest of the thread's words gather under it instead of each rooting a thread
      // of its own with no turnState — which read red "Not picked up" though every one was answered (Oren, 20 Oct,
      // #strategy: 11 such rows from one long 14 Oct thread). A client's 'wa:'/'email:' thread keeps its own rows.
      if (m.threadId && !isExternalParty(m)) { current.continued = true; byId.set(m.threadId, current); }
      items.push(current);
      continue;
    }
    const home = (m.threadId && byId.get(m.threadId)) || current;
    if (home) home.replies.push(e);
    else items.push({ type: 'standalone', entry: e }); // trigger outside window → plain bubble
  }
  return items;
}

// Turn a client name into a room-doc id. Non-Latin names (Hebrew, etc.) carry
// no a–z0–9, so the old slug collapsed every one to "-" and they all collided
// on a single room doc — each "new client" silently overwrote the last. Fall
// back to a stable base when nothing survives; the caller appends -2/-3 to keep
// ids unique. The human-readable name is stored separately as clientName.
export function roomSlug(name) {
  const s = (name || '').toLowerCase().replace(/^#/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'client';
}

// filterRoomEntries — pure search over the sidebar's full room list, so a director can jump
// straight to any room or persona by typing instead of scrolling to find it (6 Sep 2026: "make
// room switching obviously work and be reachable from anywhere on the page"). Matches the room id,
// name, or clientName as a substring anywhere (not just a prefix), case-insensitive, so "brick"
// finds "Brickwise" and "coo" finds "#coo-build". An empty query returns every entry unchanged —
// the caller supplies the sort order (most-recently-used first); this only narrows the set.
export function filterRoomEntries(entries, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const label = (e.clientName || e.name || e.id || '').toLowerCase();
    return label.includes(q) || String(e.id || '').toLowerCase().includes(q);
  });
}

// isDeadCard (ADR-2610100150zr) — `status` is not the whole truth about a card. Every retire (the board's sweeps, the
// card sweep) deliberately leaves `status: 'pending'` — the gate reads that field as a decision — and marks the card
// dead in its own fields; a `consumed` card's tap has already been acted on. Both stay pending for ever. Until 10 Oct
// 2026 the room view rendered them with live buttons and pulled every one of them in as an "older pending" card
// (ADR-2610090259en's map found 120 such). A dead card is waiting on nobody: no buttons, not counted, not merged in.
export const isDeadCard = (m = {}) => !!m && (m.retired === true || m.consumed === true);
export const PENDING_CARD = (m) =>
  (m.type === 'question' || m.type === 'approval' || m.type === 'align') && (!m.status || m.status === 'pending') && !isDeadCard(m);

// isExternalParty — a message from a CLIENT writing in over WhatsApp (the relay flush stamps `from`
// '📱 WhatsApp' + source 'whatsapp'). Not a director, not one of our agents. A finished thread whose
// last word is a client's pure acknowledgement ("great, we'll look at it today 😊") owes us nothing —
// it is FYI, not a thread "awaiting Cleo". Before this, such a thread read `replied-awaiting`, which
// itemClearable never folds (it takes only `done`), so 🧹 Clear could not dismiss it and it nagged for
// ever with no state that fit a no-action message.
export const isExternalParty = (m) => !!m && (m.source === 'whatsapp' || m.from === '📱 WhatsApp' || isInboundEmail(m));

// isInboundEmail — an email that reached Cleo's inbox (adapters/gmail/watch.mjs stamps `from` '📧 Email' + source
// 'email' and `relayed:false→true` once the relay has read it). Whoever wrote it — Michal, Elad, Google — it is mail,
// not a director at the console waiting on Cleo (Oren, 12 Oct: a column of red "Not picked up" emails). Read and no
// turn ran → "No action needed"; only an email the relay never read (`relayed` not true after NOTPICKED_AFTER_MS) is
// red, because that is a real ingest failure.
export const isInboundEmail = (m) => !!m && (m.source === 'email' || m.from === '📧 Email');

// Task status comes from the relay's turnState on the thread root — the relay
// is the single source of truth. The only override: an undecided card always
// shows "Needs you". `now` is injectable for tests.
export function taskStatus(item, now = Date.now()) {
  const t = item.trigger.m;
  // Decision cards own their own status field — never let the legacy ghost
  // expiry turn them 'done' before each director has answered.
  if (t.type === 'decision') {
    const ds = t.status || 'pending';
    return (ds === 'consensus' || ds === 'conflict') ? 'done' : 'waiting';
  }
  if (item.replies.some((r) => PENDING_CARD(r.m))) return 'waiting';
  // Goal-3 "did my message land?": detect a real (human) director speaking LAST with no brain answer after them.
  // Excludes auto-drain / internal-ops posts (those are self-issued dispatch triggers, not a director awaiting a reply).
  const tsOf = (r) => { const c = r.m?.createdAt; return c ? (c.toMillis?.() ?? c) : 0; };
  const lastEntry = [item.trigger, ...item.replies].reduce((b, r) => (tsOf(r) >= tsOf(b) ? r : b), item.trigger);
  const isAutoOps = (m) => /auto-?drain|internal ops|backlog drain/i.test(`${m?.author || ''} ${m?.text || ''}`);
  const isDirSide = (m) => !!m && !AGENT_SENDERS.has(m.from) && !isCleoSelf(m) && !PENDING_CARD(m) && !isExternalParty(m)
    && !['question', 'approval', 'decision', 'align', 'chat'].includes(m.type) && !isAutoOps(m);
  // A client speaking last after a FINISHED turn is FYI, not "awaiting Cleo" (the `done` branch reads this
  // first, below). An UNhandled inbound (no turn ran) still falls through to notpicked, so nothing a client
  // sent is ever silently dropped (ADR-0223).
  const externalSpokeLast = isExternalParty(lastEntry.m);
  const directorSpokeLast = isDirSide(lastEntry.m);
  const anyBrain = item.replies.some((r) => r.m.from === 'brain');
  switch (t.turnState) {
    case 'queued': return (now - tsOf(lastEntry)) > QUEUED_STUCK_AFTER_MS ? 'stuck' : 'pending';
    case 'working': {
      // A genuinely-running turn posts updates constantly and finishes within a
      // couple of minutes. If a thread is stuck on turnState=working with no new
      // activity for STUCK_AFTER_MS, the turn was interrupted (crash, context
      // exhaustion) and is not coming back — flag it 'stuck' (red) rather than
      // letting the wait-counter climb "Working" forever. Self-corrects the
      // moment any new message lands.
      const msgs = [item.trigger, ...item.replies];
      const latest = msgs.reduce((best, r) => {
        const ts = r.m?.createdAt;
        const ms = ts ? (ts.toMillis?.() ?? ts) : 0;
        return ms > best ? ms : best;
      }, 0);
      if (latest && (now - latest) > STUCK_AFTER_MS) return 'stuck';
      return 'working';
    }
    case 'waiting': return 'working'; // card just decided — turn is resuming
    case 'done': {
      if (t.errored) return 'stuck';
      // ADR-0223: the kernel decided on purpose not to run a turn (a no-substance WhatsApp burst) and recorded it.
      if (t.turnSkipped) return 'done';
      // A turn PARKED on the Claude usage limit / overload (kernel status limited|throttled) mirrors as
      // retrying:true. It is NOT stuck (red) and NOT actively working — it is waiting for the cap to reset and
      // will auto-resume (sweepRetries). Render it as its own 'paused' state so the director SEES a usage-limit
      // hold ("Paused — usage limit") instead of a red Stuck or a misleading forever-"Working" spinner.
      if (t.retrying) return 'paused';
      // A pure-FYI inbound: the turn finished and a CLIENT's message is the last word (an ack — "thanks",
      // "we'll look today"). Cleo rightly stays silent on chatter, so nothing is owed. This is its own
      // no-action state ("No action needed"), clearable in one tap; without it the thread read
      // "awaiting Cleo" and could never be cleared. A real director-last still → replied-awaiting below.
      if (externalSpokeLast) return 'fyi';
      // Goal-3: the turn FINISHED but a (human) director spoke last and it was never answered — surface
      // "Sent — awaiting Cleo" instead of a misleading "Done". (Going forward the never-silent release means a
      // reply lands, flipping this back to done; this catches the gap + every historical unanswered thread.)
      if (directorSpokeLast) return 'replied-awaiting';
      // ADR-2610110442jr: in a goal room the relay keeps the item's ONE state on its root (`goal`, kernel2/goal-logic.mjs).
      // It wins over the guess from the reply's tail below: an open goal is still being worked, a question needs you.
      // A `waiting` goal is parked on something outside (a CI run, a deploy, a card, tomorrow's retro): nothing runs, so it
      // is never "Working" — 15 Oct, Oren: "why are they stuck, hours in the same state?" It reads "Waiting on …" with its note.
      // The one map (GOAL_STATUS) is also what a thread chip reads (refStatus).
      const goal = GOAL_STATUS[t.goal?.state];
      if (goal) return goal;
      // The turn is done but the task may still be live: check whether the last
      // brain reply ends with a forward-looking commitment ("will report", "checking
      // now", etc.). Only the tail of the message matters — avoid false positives
      // from "waiting for X → now resolved" mid-message phrases.
      const lastBrain = [...item.replies].reverse().find(r => r.m.from === 'brain');
      const tail = (lastBrain?.m?.text || '').slice(-400).toLowerCase();
      // Only keep the 'working' override if the last brain message is recent (< 2 h).
      // After 2 h with no new turn, trust 'done' — the thread is stalled, not running.
      const lastBrainAge = lastBrain?.m?.createdAt
        ? (Date.now() - (lastBrain.m.createdAt.toMillis?.() ?? lastBrain.m.createdAt)) : Infinity;
      // Only keep 'working' when the brain kicked off something that is ACTUALLY
      // still running and being watched (a deploy, a monitor) — NOT merely because
      // a message said "I'll continue later". Between turns nothing runs, so a
      // vague "continuing" must not fake a live spinner.
      if (lastBrainAge < 2 * 60 * 60 * 1000 &&
          /will report|will update|will follow|will let you|will send|will share|will check|will monitor|as soon as|standing by|waiting for|checking.*live|monitoring|verif(y|ying|ication) (?:is )?running/.test(tail)) {
        return 'working';
      }
      return 'done';
    }
    default: {
      // An inbound email or WhatsApp message the relay read and chose not to act on ("silent otherwise") owes
      // nothing: fyi, clearable. One it never read is a real ingest failure and stays red once NOTPICKED_AFTER_MS
      // has passed. (Oren, 13 Oct, #justin: a read WhatsApp-watch message with no turn read red "Not picked up" —
      // a needs-a-push state, so neither 🧹 Clear, a swipe nor 📦 could put it away.)
      if (isExternalParty(lastEntry.m)) {
        if (lastEntry.m.relayed === true) return 'fyi';
        return (now - tsOf(lastEntry)) > NOTPICKED_AFTER_MS ? 'notpicked' : 'pending';
      }
      // A post the kernel wrote as 'Cleo' (a delegation outcome, an event-wake, a build request) is done and
      // clearable once the relay has read it. One it never read is a post that should have started a turn and
      // did not (an event-wake, or a build request in a -build room): red after NOTPICKED_AFTER_MS, whatever its
      // kind. (13 Oct: read 'Cleo' posts showed as a director speaking last → red, uncleareable; stand-in review
      // of #750: deciding by kind would have shown an unread build request as done.)
      if (isCleoSelf(lastEntry.m)) {
        if (lastEntry.m.relayed === true) return 'done';
        return (now - tsOf(lastEntry)) > NOTPICKED_AFTER_MS ? 'notpicked' : 'pending';
      }
      // Goal-3 unrouted-reply guard: a (human) director spoke last with NO turnState (the relay never picked it
      // up). After NOTPICKED_AFTER_MS: red "Not picked up" if Cleo NEVER engaged, else "Sent — awaiting Cleo" —
      // never the old silent fade to "done" that hid the #brickwise HALT.
      if (directorSpokeLast && (now - tsOf(lastEntry)) > NOTPICKED_AFTER_MS) {
        // A continued thread's turn state lives on its root, outside the window: a reply the Mac read was picked up.
        return anyBrain || (item.continued && lastEntry.m?.relayed === true) ? 'replied-awaiting' : 'notpicked';
      }
      // ADR-0227: a thread whose latest entry is Cleo's own report (no turn ever ran on it) asks nothing — done.
      if (AGENT_SENDERS.has(lastEntry.m?.from)) return 'done';
      // Legacy docs from before the relay wrote turnState
      if (item.replies.length) return 'done';
      const ts = t.createdAt?.toMillis?.() || 0;
      return now - ts > 15 * 60000 ? 'done' : 'pending'; // expire old ghosts
    }
  }
}

// 'archived' is a display-only stage applied to done tasks once they fold into
// the drawer (see partitionArchive) — the relay never writes it.
// viewableImage — may this message image be shown and opened full-size? A web image (https) or an image carried inside the
// message (a data: URL of a raster type — what a director's upload and Boss's post-image tool write). Anything else
// (javascript:, data:text/html, svg) is never shown. 15 Oct, Oren: "I don't understand why you don't show images — make it
// easy to see and zoom." Pure.
export function viewableImage(url = '') {
  const u = String(url || '');
  return /^https:\/\//i.test(u) || /^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(u);
}

export const STATUS_LABELS = { working: 'Working', waiting: 'Needs you', done: 'Done', stuck: 'Stuck', pending: 'Pending', archived: 'Archived', paused: 'Paused — usage limit', 'replied-awaiting': 'Sent — awaiting Cleo', notpicked: 'Not picked up', fyi: 'No action needed', 'on-hold': 'Waiting on' };

// Room-list indicator (pill + state classes) derived from the ROOM doc alone.
// The relay mirrors each turn's state onto room.turn and bumps room.lastMessageAt
// on every message, so the app's existing rooms-collection listener carries
// everything the list needs. This replaced a per-room message listener (one
// 25-message subscription per room, per device) that was a major Firestore read
// sink — every page load / mobile reconnect re-read 25 × (rooms) documents.
//   needs-you : a director-facing card is open               → room.waitingOn
//   working   : the room's current turn is running/resuming  → room.turn.turnState
//   stuck     : the current turn errored and isn't retrying  → room.turn.errored
//   pending   : the turn is queued but hasn't started yet     → room.turn.turnState
//   unread    : a message newer than this viewer has seen (never for the open room)
// Turns are serial within a room, so room.turn tracks the room's current turn.
// ADR-2610092304fx: an owned room (room.owner, stamped by the board from config rooms.owners) needs only its
// owner — `me` is the signed-in director's name; for the other director the room shows no "needs you".
// roomSeenTs — when this director last saw a room, across devices (Oren, 25 Oct 2026: "is it synced whatever platform
// I log in from?"). The console kept it only in this browser's localStorage, so a room read on the phone stayed unread
// on the laptop. The synced copy rides the director's own entry in `elad-oren-config/drafts` (`<Name>.seen.<roomId>`,
// ms); the later of the two wins, so a device that never synced still counts what it saw itself.
export function roomSeenTs(localTs, remoteSeen, rid) {
  const l = Number(localTs) || 0;
  const r = Number(remoteSeen?.[rid]) || 0;
  return Math.max(l, r);
}
// Thread read stamps sync the same way (Oren, 27 Oct 2026: "I saw the dot, handled it; a day later Elad taps the same
// dot — where does he land?"). A thread's blue bar compared its last activity with this browser's `eo-read-<id>` only,
// so a thread read on the phone was unread again on the laptop. The synced copy is `<Name>.read.<rootId>` (ms) in the
// same drafts entry, read through roomSeenTs (the later wins). staleReadIds names the stamps older than READ_KEEP_MS, which
// the console deletes so the doc stays small: a thread quiet that long is not unread without a stamp, and one that moved
// since is unread with or without it.
// sameStamps — two { id: ms } maps hold the same stamps, whatever their key order (a JSON compare saw the server's
// sorted copy as a change and re-drew the room).
export function sameStamps(a = {}, b = {}) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b || {}, k) && Number(a[k]) === Number(b[k]));
}
export const READ_KEEP_MS = 30 * 24 * 3600 * 1000;
export function staleReadIds(read = {}, nowMs = Date.now(), keepMs = READ_KEEP_MS) {
  return Object.keys(read || {}).filter((k) => !(Number(read[k]) > nowMs - keepMs));
}
export function roomIndicator(room = {}, { seenTs = 0, isOpen = false, me = '' } = {}) {
  const turn = room.turn || {};
  const waiting = !!room.waitingOn && (!room.owner || room.owner === me);
  // paused: the room's current turn is PARKED on the usage limit / overload (retrying) — auto-resumes at the
  // reset. Split out of `working` so the room list shows a distinct "paused" pill, never red 'stuck' and never
  // a forever-spinning "working…". stuck stays reserved for a GENUINE errored turn that is NOT retrying.
  const paused = !waiting && !!turn.retrying;
  const working = !waiting && !paused &&
    (turn.turnState === 'working' || turn.turnState === 'waiting');
  const stuck = !waiting && !working && !paused &&
    turn.turnState === 'done' && !!turn.errored && !turn.retrying;
  const pending = !waiting && !working && !paused && !stuck && turn.turnState === 'queued';
  const lastTs = room.lastMessageAt?.toMillis?.() || 0;
  const unread = !isOpen && lastTs > seenTs;
  const pill = waiting ? 'needs you' : paused ? 'paused' : working ? 'working…' : stuck ? 'stuck' : pending ? 'pending' : '';
  return { waiting, working, paused, stuck, pending, unread, pill };
}

// ── the archive: the room shows what is RECENT, and nothing folds on its own ──
// There is no auto-archive (Cleo, 2026-09-24: "most of the time I want the threads
// active in the last hours or today; when needed I'll press Clear"). The old rule
// folded a done thread the moment it looked delivered, closed or decided, which
// guessed from reactions and prose and emptied the room behind the director's back.
// Now an item leaves the timeline for exactly two reasons, both in partitionArchive:
//   • the director cleared it (🧹 Clear, 📦, a swipe), or
//   • it is FINISHED and its last activity is before `recentSince` — the start of
//     today, or RECENT_MS ago if that is earlier, so just after midnight the room
//     still holds the evening's work.
// A thread still working, stuck, queued, paused or waiting, and any open card,
// stays in the room however old it is.
export const RECENT_MS = 6 * 60 * 60 * 1000;
export function recentSince(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0); // the viewer's local day — Sydney for the directors
  return Math.min(midnight.getTime(), now - RECENT_MS);
}

export function lastActivity(item) {
  const ts = (e) => e.m.createdAt?.toMillis?.() || 0;
  return Math.max(ts(item.trigger), ...item.replies.map(ts));
}

// Activity timestamp for ANY item (task or standalone) — used to order the
// live timeline so the most-recently-touched thread sits at the bottom.
export function itemActivity(item) {
  return item.type === 'task'
    ? lastActivity(item)
    : (item.entry.m.createdAt?.toMillis?.() || 0);
}

// Newest activity last → a reactivated done thread jumps to the bottom ("now").
// Stable: equal timestamps keep their incoming (chronological) order.
export function sortByActivity(items) {
  return items
    .map((item, i) => [item, i])
    .sort(([a, ai], [b, bi]) => itemActivity(a) - itemActivity(b) || ai - bi)
    .map(([item]) => item);
}

// ── Stable order and the new-message arrow (Oren, 26 Oct 2026: "no more reordering of threads"; ADR-2610260152kv) ──
// rootCreatedAt — when a feed item was born: a thread's root message, or the standalone message itself. A reply never
// changes it, so a thread keeps its place in the room however much is said in it.
const msOf = (e) => e?.m?.createdAt?.toMillis?.() || 0;
export function rootCreatedAt(item) {
  return item.type === 'task' ? msOf(item.trigger) : msOf(item.entry);
}

// sortByCreation — the room feed's order: oldest root first, the newest thread last. Stable: equal times keep their
// incoming order. The mirror of sortByActivity, which the multi-room filter view still uses.
export function sortByCreation(items) {
  return items
    .map((item, i) => [item, i])
    .sort(([a, ai], [b, bi]) => rootCreatedAt(a) - rootCreatedAt(b) || ai - bi)
    .map(([item]) => item);
}

// unseenMessageIds — the messages this director has not seen yet in this visit to the room: written after he entered
// (createdAtMs > lastSeenMs), not by him, and not yet on his screen (seenIds). A message with no time (0) is never new.
// msgs: [{ id, createdAtMs, from }] → [id] in the input's order.
export function unseenMessageIds(msgs = [], { seenIds = new Set(), lastSeenMs = 0, me = '' } = {}) {
  return msgs
    .filter((x) => x && x.id && (x.createdAtMs || 0) > lastSeenMs && (!me || x.from !== me) && !seenIds.has(x.id))
    .map((x) => x.id);
}

// newMessagePill — the floating arrow. unseen: [{ id, position: 'above' | 'visible' | 'below' }], oldest first.
// Nothing off screen → null. Only above → ↑ to the oldest above. Below (or both) → ↓ to the oldest below, counting
// every unseen message off screen.
export function newMessagePill(unseen = []) {
  const above = unseen.filter((u) => u.position === 'above');
  const below = unseen.filter((u) => u.position === 'below');
  if (!above.length && !below.length) return null;
  if (!below.length) return { dir: 'up', count: above.length, targetId: above[0].id };
  return { dir: 'down', count: above.length + below.length, targetId: below[0].id };
}

// unseenInThread — the count on a closed thread's head: its messages this director has not seen (unseenMessageIds).
// A live-activity strip is not a message.
export function unseenInThread(item, opts = {}) {
  if (!item || item.type !== 'task') return 0;
  const msgs = [item.trigger, ...(item.replies || [])]
    .filter((e) => e?.m && e.m.kind !== 'activity')
    .map((e) => ({ id: e.id, createdAtMs: msOf(e), from: e.m.from }));
  return unseenMessageIds(msgs, opts).length;
}

// ── delivered: the green dot ─────────────────────────────────────────────
// A done thread earns the green dot when Cleo's last message asserts a concrete
// result (live, shipped, fixed, a link…) or a director closed it (a 👍/✅/🎉
// reaction or a "thanks/perfect/done" reply). This colours the dot only; it never
// hides a thread (see recentSince).
const CLOSE_RE = /(^|\W)(thanks|thank you|thx|תודה|perfect|מושלם|great|awesome|nice|lgtm|ship it|done|resolved|close this|👍|🙏|✅|🎉|❤️|🔥)(\W|$)/i;
const DELIVERED_RE = /\b(it'?s live|live now|deployed|shipped|fixed|resolved|verified|completed|merged)\b|https?:\/\//i;
// A progress/status note is NOT a delivery, even if it happens to contain a word
// like "live" or "report" — otherwise "watch is live" or "I'll report at
// completion" falsely turn the thread green. (Oren, 2026-07-20.)
const IN_PROGRESS_RE = /\b(progressing|in progress|underway|running|mid-?flight|still|shortly|hold on|no action needed|will (report|confirm|update)|i'?ll (report|confirm|update)|watch is live|watching|in the .{0,20}step|re-?running|relaunch)/i;
const POSITIVE_EMOJI = ['👍', '✅', '🎉', '❤️', '🔥', '🙏'];

function directorClosed(item, directorNames = []) {
  const set = new Set(directorNames);
  const reacted = [item.trigger, ...item.replies].some((e) => {
    const r = e.m.reactions || {};
    return POSITIVE_EMOJI.some((em) => (r[em] || []).some((n) => set.has(n)));
  });
  if (reacted) return true;
  const lastDir = [...item.replies].reverse().find((e) => set.has(e.m.from));
  return !!lastDir && CLOSE_RE.test(lastDir.m.text || '');
}

function brainDelivered(item) {
  const lastBrain = [...item.replies].reverse().find((e) => e.m.from === 'brain');
  if (!lastBrain) return false;
  const t = lastBrain.m.text || '';
  if (IN_PROGRESS_RE.test(t)) return false; // a status/progress note isn't a delivery
  return DELIVERED_RE.test(t);
}

// A 'done' thread only earns the GREEN dot when the work is TRULY delivered —
// the last brain message asserts a concrete result (live/shipped/fixed/a link),
// or a director closed it (👍/✅ or "thanks/perfect"). A turn that merely FINISHED
// replying without delivering anything shippable stays neutral, not green — so a
// thread that's still live work never looks finished. (Oren, 2026-07-20.)
export function taskDelivered(item, directorNames = []) {
  return brainDelivered(item) || directorClosed(item, directorNames);
}

// ── the archive key: ONE derivation, used by every reader and every writer ──
// A cleared item is remembered by this key alone. It used to be spelled out
// separately in the renderer (index.html) and here, and a unit test pinned the
// two literals against each other — a guard that a drift can still slip past if
// a third caller spells it a third way. Clear-room needs the same key for a
// whole room at once, so the derivation became a function instead: reader and
// writer cannot disagree when there is only one of them.
//
// `m.threadId || fallbackId`, because a `standalone` item is not always
// key-less: clusterMessages files an entry as standalone when its threadId
// names a parent OUTSIDE the loaded window, so it carries a threadId with no
// parent to attach to. Reading the doc id alone silently missed exactly the
// older messages a director most wants cleared (ADR-0146).
export const archiveKey = (m, fallbackId) => (m && m.threadId) || fallbackId;

// The same key for a clustered item, whichever shape it has.
export function itemArchiveKey(item) {
  if (!item) return undefined;
  // A continued thread (its root older than the window) is cleared by its root's id: its first reply in the window is
  // the next to slide out, and a clear keyed on it would let the thread come back (quick review of #855).
  if (item.type === 'task') return item.continued ? item.trigger.m.threadId : item.trigger.id;
  return archiveKey(item.entry.m, item.entry.id);
}

// Every key that names this item as cleared. A thread is cleared by its root's id (🧹 Clear, a swipe) OR by the
// threadId its root carries (📦 on the root writes archiveKey(m) = m.threadId). The two differ only when the root is
// not its own thread: a WhatsApp-watch message (threadId 'wa:<group>'), an inbound email ('email:<id>'), a reply
// whose root is older than the window. Reading only the id missed every 📦 on those (Oren, 13 Oct: 'wa:justin' sat in
// #justin's archivedThreads while the thread stayed in the feed).
export function itemArchiveKeys(item) {
  const key = itemArchiveKey(item);
  const tid = item?.type === 'task' ? item.trigger?.m?.threadId : undefined;
  return [key, tid].filter((k, i, a) => k && a.indexOf(k) === i);
}
export const isItemCleared = (item, manuallyArchived = new Set()) => itemArchiveKeys(item).some((k) => manuallyArchived.has(k));

// Does this item still want something FROM a director? An unanswered question,
// approval or align card, or an undecided decision card — on the item itself or
// anywhere in its replies. Nothing here is ever hidden, by an auto-fold or by an
// explicit clear: it is the invariant the task branch of partitionArchive leans
// on the renderer's pendingRescued pass to hold, and the standalone branch holds
// inline. Clear-room honours it too, so "Clear all" can never bury a tap.
export function itemNeedsDirector(item) {
  if (!item) return false;
  if (item.type === 'task') return [item.trigger, ...item.replies].some((e) => PENDING_CARD(e.m));
  const m = item.entry.m;
  if (m.type === 'decision') return !['consensus', 'conflict', 'resolved'].includes(m.status);
  return PENDING_CARD(m);
}

// A thread in one of these states has stopped with nobody moving it: it errored
// or went silent mid-turn ('stuck'), or the relay never took a director's message
// ('notpicked'). Neither an explicit clear nor Clear-room may keep it hidden.
// 'replied-awaiting' is deliberately not here: it is also what a director's own
// closing "thanks" reads as, and that thread they meant to put away.
export const NEEDS_A_PUSH = new Set(['stuck', 'notpicked']);

// Clear-room: the keys one "Clear all" tap should add to `manuallyArchived`.
//
// It returns the DELTA, not the resulting set — the keys that were not already
// cleared. That is what makes Undo exact: putting back only what this tap took
// restores the room to precisely its prior state, instead of un-clearing threads
// the director had cleared earlier and expects to stay gone.
//
// A THREAD is taken only when its state is 'done' — the status taskStatus reads
// from the relay's turnState, the one field that holds a thread's state. Clear
// used to ask only "is a card open?", so it folded threads that were still
// working, stuck, queued, paused on the usage limit, or waiting on Cleo's answer
// to a director — the director pressed Clear and live work vanished (Cleo,
// 2026-09-24). Asking for 'done' rather than listing what to spare means a
// status added later is kept by default instead of silently cleared.
export function itemClearable(item) {
  if (!item || itemNeedsDirector(item)) return false;
  // 'done' (work finished) and 'fyi' (a client's no-action acknowledgement) are the terminal states a
  // director may fold away. Everything else — working, stuck, queued, paused, or awaiting Cleo — stays.
  return item.type !== 'task' || item.status === 'done' || item.status === 'fyi';
}

export function planClearRoom(items = [], manuallyArchived = new Set()) {
  const keys = [];
  for (const item of items) {
    if (!itemClearable(item)) continue;
    const key = itemArchiveKey(item);
    if (!key || manuallyArchived.has(key) || keys.includes(key)) continue;
    keys.push(key);
  }
  return keys;
}

// Folding the room doc's `archivedThreads` back into the local set, without
// letting a stale snapshot undo an Undo.
//
// The sync only ever ADDED, which is correct for a clear (another device cleared
// a thread; this one should agree) and wrong for an un-clear: a snapshot already
// in flight when Undo ran still lists the keys, so it puts them straight back and
// the room springs shut again — the same "it came back on its own" class as
// ADR-0146. A key this session just un-cleared is therefore held out of the merge
// until the server stops listing it, at which point the server IS the local
// state and the hold-out has nothing left to do. No timer, no guessing: it
// reconciles to what is actually there.
export function reconcileArchiveSync(remoteKeys = [], undone = new Set()) {
  const remote = new Set(remoteKeys);
  return {
    adds: remoteKeys.filter((k) => !undone.has(k)),
    settled: [...undone].filter((k) => !remote.has(k)),
  };
}

// Which archived items offer a Restore, and which are just folded away.
//
// Only an item the DIRECTOR put in the archive can be taken back out. An
// auto-folded one — a settled thread, an old system message — was never an act
// of theirs, and "restoring" it would be a lie: the same auto-fold rule would put it
// straight back on the next render. The drawer is already openable, so nothing
// is unreachable; what would be unreachable is a clear they now regret, and that
// is exactly what this restores.
//
// Keeping it to one state is the point. A restore for an auto-folded item would
// need a second "pinned live" set alongside `manuallyArchived`, two sets that
// must be kept mutually exclusive by hand — the ambiguity the doctrine says to
// refactor away rather than add.
export function canRestore(item, manuallyArchived = new Set()) {
  return isItemCleared(item, manuallyArchived);
}

// What an empty room says (20 Oct 2026, Elad on #brickwise: "everything is blank"). After a Clear all every item sits
// in the archive, whose drawer is closed by default — so the timeline was a blank page that read as broken. A room
// with nothing live says so in one line, and names the archive when there is one; null when something is live.
export function roomEmptyLine(liveCount, archivedCount) {
  if (liveCount > 0) return null;
  if (archivedCount > 0) return { text: `All clear — ${archivedCount} in the archive. Tap to show them.`, opensArchive: true };
  return { text: 'Nothing here yet.', opensArchive: false };
}

// Which items are in the room and which are in the archive. No auto-archive:
// see recentSince. `opts.since` overrides the recent window (tests, callers that
// already computed it).
export function partitionArchive(items, now = Date.now(), manuallyArchived = new Set(), opts = {}) {
  const since = opts.since ?? recentSince(now);
  const archived = [], live = [];
  for (const item of items) {
    let old = false;
    if (item.type === 'task') {
      // An explicit clear is STICKY: once a director clears a thread it stays
      // folded even if fresh activity (a brain follow-up, a relabelled WhatsApp
      // message) later flips it off 'done' — otherwise every reactivation springs
      // cleared threads back ("archived threads reappeared on their own").
      //
      // Except a thread that needs a PUSH: stuck (errored, or a turn that went
      // silent) or never picked up. Hiding it is how a stuck task stops being
      // visible, so it comes back out, the same way an open card does (the
      // renderer's pendingRescued pass).
      const cleared = isItemCleared(item, manuallyArchived) && !NEEDS_A_PUSH.has(item.status);
      // A finished thread from before the recent window leaves the room. Only a
      // finished one: a thread still live stays however old it is.
      // 'fyi' (no action needed) is as finished as 'done': an old one folds the same way.
      const earlier = (item.status === 'done' || item.status === 'fyi') && itemActivity(item) < since;
      old = cleared || earlier;
    } else if (item.type === 'standalone') {
      const m = item.entry.m;
      // A still-pending card (a decision awaiting a tap, an unanswered question,
      // approval or align) is NEVER hideable — not by a clear, not by age. One
      // mechanism for "this still wants a director": itemNeedsDirector.
      if (!itemNeedsDirector(item)) {
        // The key comes from archiveKey — the one derivation every reader and
        // writer shares. See its comment for why the doc id alone is not enough.
        old = manuallyArchived.has(archiveKey(m, item.entry.id)) || itemActivity(item) < since;
      }
    }
    (old ? archived : live).push(item);
  }
  // Never leave a room completely blank — always keep at least one item visible.
  // Prefer rescuing a task; fall back to any item (e.g. a standalone brain message).
  // An item the director cleared by hand is NOT rescue material. The rescue
  // exists so the auto-fold can never leave a director staring at a void; it was
  // never meant to overrule an explicit tap. Before Clear-room that distinction
  // did not matter, because clearing every item by hand was not a thing you
  // could do in one gesture. Now it is — and without this filter "Clear all"
  // would always leave one thread sitting there, reading as a half-working
  // button. The drawer header is still on screen, so a fully-cleared room is not
  // a void.
  const rescuable = archived.filter((i) => !isItemCleared(i, manuallyArchived));
  if (live.length === 0 && rescuable.length > 0) {
    const tasks = rescuable.filter(i => i.type === 'task');
    const pool = tasks.length ? tasks : rescuable;
    const newest = pool.reduce((a, b) => itemActivity(a) >= itemActivity(b) ? a : b);
    archived.splice(archived.indexOf(newest), 1);
    live.push(newest);
  }
  return { archived, live };
}

// Relay heartbeat → indicator state. Offline = 3 missed 30s beats.
export function relayStatus(info, now = Date.now()) {
  if (!info) return null;
  const last = info.lastSeen?.toMillis?.() || 0;
  if (now - last >= 90000) return {
    cls: 'off', text: 'brain offline',
    title: 'The brain has stopped responding — tap 🔄 Restart brain',
  };
  // No "restart pending" state: the relay self-restarts when newer code is on
  // disk (see heartbeat), so the indicator is just online ↔ offline.
  return { cls: 'ok', text: info.sha || 'online', title: `Brain online · running ${info.sha}` };
}

// Detect whether a thread has an active loop/cron and parse its schedule.
// Returns { freq: 'daily'|'hourly'|'weekly'|'loop', time: '8:07am'|null }
// or null if no loop signal found.
export function detectLoop(item) {
  const joined = item.replies
    .filter(r => r.m.from === 'brain')
    .map(r => r.m.text || '')
    .join('\n');
  if (!/loop.*(running|active|set up|scheduled)|cron.*(running|job)|daily loop/i.test(joined)) return null;
  // "8:07am daily" or "daily at 8:07am" or "loop is running at 8:07am daily"
  const m = joined.match(/(\d{1,2}:\d{2}\s*[ap]m)\s+(daily|weekly|hourly)/i)
    || joined.match(/(daily|weekly|hourly).*?at\s+(\d{1,2}:\d{2}\s*[ap]m)/i);
  if (m) {
    const isTimeFirst = /\d+:\d+/.test(m[1]);
    const time = (isTimeFirst ? m[1] : m[2] || '').replace(/\s+/g, '').toLowerCase();
    const freq = (isTimeFirst ? m[2] : m[1] || 'daily').toLowerCase();
    return { freq, time: time || null };
  }
  return { freq: 'loop', time: null };
}

// Milliseconds from `now` until the next fire of a time-based loop schedule.
// `time` is a string like "8:07am". Returns null if unparseable.
export function nextRunMs(time, now = Date.now()) {
  if (!time) return null;
  const m = time.match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3] && m[3].toLowerCase() === 'pm' && h !== 12) h += 12;
  if (m[3] && m[3].toLowerCase() === 'am' && h === 12) h = 0;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1); // tomorrow
  return d.getTime() - now;
}

// Classify why a brain turn ended in error, so the relay reacts correctly
// instead of always telling the director to "resend". Precedence matches the
// relay's historical branching: usage limit → user/idle abort → auth → generic.
//   'auth' = a 401 / invalid-credentials failure. The Mac's Claude subscription
//   login expired or rotated; the relay can't re-auth itself (that needs a
//   browser), so resending only re-fails — only a re-login on the Mac fixes it.
export function classifyTurnError(message, { aborted = false } = {}) {
  const m = String(message || '');
  if (/usage limit|session limit|rate limit/i.test(m)) return 'limited';
  if (/\b529\b|overloaded/i.test(m)) return 'overloaded';
  if (aborted || /timed out|aborted by user/i.test(m)) return 'aborted';
  if (/\b401\b|invalid authentication|authentication_error|failed to authenticate|please run\s+\/?login|oauth token (?:expired|revoked|invalid)/i.test(m))
    return 'auth';
  return 'error';
}

// Should the relay self-deploy the app? True when the LIVE deployed git sha
// differs from main AND the undeployed delta touches app files (public/ or
// functions/). Relay/memory-only changes don't need an app deploy. The relay's
// deploy reconciler uses this to ship work that CI silently failed to deploy —
// closing the "marked done but never went live" gap. (changedFiles is the
// newline-separated output of `git diff --name-only <liveSha>..HEAD`.)
export function needsAppDeploy(localSha, liveSha, changedFiles = '') {
  if (!localSha || !liveSha || localSha === liveSha) return false;
  return /(^|\n)\s*(public\/|functions\/)/.test(changedFiles || '');
}

// A turn that hit the Claude usage limit / overload is marked `retrying` on its
// thread root with a `retryAtMs`. The relay's retry reconciler re-runs it once
// the reset passes. Because the flag lives on EACH thread root (not one slot per
// room — which used to lose every retry but the last), no two limited threads can
// overwrite each other. Returns true when a thread is due to be re-run.
export function dueForRetry(retrying, retryAtMs, now = Date.now()) {
  return !!retrying && (!retryAtMs || retryAtMs <= now);
}

// When two rooms edit the same lines of the same file concurrently, the second
// room's merge-back can't auto-resolve even after a rebase (git's normal 3-way).
// Rather than strand the work on a branch and ask a director to fix it (Oren's
// standing rule: NEVER pull a director into git), the relay enqueues a brain turn
// that resolves it itself. This builds that turn's instruction — deterministic so
// it can be unit-tested. `branch` is the brain/<room> branch holding the work.
export function conflictResolvePrompt(branch, roomName = '') {
  const where = roomName ? ` in ${roomName}` : '';
  return [
    `[auto] Your last turn${where} produced changes that couldn't merge into main`,
    `because another room changed the same code at the same time. The work is safe`,
    `on branch ${branch} (also pushed to origin). Resolve it yourself — do NOT ask`,
    `the directors. Steps: \`git fetch origin ${branch}\`, then`,
    `\`git merge origin/${branch}\` from main, resolve every conflict by KEEPING`,
    `BOTH intents (never blindly take one side), run \`npm test\`, and only then`,
    `commit. If a conflict is genuinely irreconcilable, keep main working and`,
    `explain what clashed — but try hard to fold both changes in first.`,
  ].join(' ');
}

// foldMsg — decide whether a chat message renders COLLAPSED with a "Show more" expander, and what the collapsed
// preview text is. A long PASTED block should not render full-height / scroll-forever. Two independent triggers so a
// tall multi-line paste folds even when it is under the char cap:
//   • too many CHARACTERS (> charCap, default 300 — the historical threshold), OR
//   • too many LINES     (> lineCap, default 8).
// The collapsed preview is capped BOTH ways — at most `previewLines` lines (default 3) AND `previewChars` chars
// (default 200) — so a folded message is never taller than a few lines regardless of how the paste is shaped.
// Pure + deterministic (no DOM); the caller (index.html renderMsg) turns {fold, short, full} into the msg-short /
// msg-full / show-more spans. `full` is the original text unchanged (the stored/sent text is never altered).
export function foldMsg(text, { charCap = 300, lineCap = 8, previewChars = 200, previewLines = 3 } = {}) {
  const full = String(text == null ? '' : text);
  const lines = full.split('\n');
  const fold = full.length > charCap || lines.length > lineCap;
  if (!fold) return { fold: false, short: full, full };
  // preview: first `previewLines` lines, then clamp the whole thing to `previewChars`.
  let short = lines.slice(0, previewLines).join('\n');
  if (short.length > previewChars) short = short.slice(0, previewChars);
  // never emit a preview identical to the full text (would show an expander that does nothing).
  if (short.length >= full.length) short = full.slice(0, Math.max(1, Math.min(previewChars, full.length - 1)));
  return { fold: true, short: cutBeforeUrl(short, full), full };
}
// cutBeforeUrl — a preview `short` (a prefix of `full`) that ends inside a URL ends before it instead: a cut URL is a
// broken link, and a cut thread URL would name the wrong thread (threadLinkRef). Unchanged when no URL is cut, and when
// the URL is all there is.
export function cutBeforeUrl(short = '', full = '') {
  if (!short || short.length >= full.length || /\s/.test(full[short.length])) return short;
  const m = short.match(/(^|\s)(\S*https?:\/\/\S*)$/);
  if (!m) return short;
  const cut = short.slice(0, short.length - m[2].length).trimEnd();
  return cut || short;
}

// Turn a commit subject into a director-friendly "what's new" line for the update
// banner: strip the conventional-commit type/scope prefix and a trailing (#123)
// issue ref, capitalise. Used by stamp-version so the banner reflects the ACTUAL
// change each deploy — never a stale static line that repeats every update.
export function cleanWhatsnew(subject = '') {
  let s = String(subject).trim()
    .replace(/^(feat|fix|chore|ui|design|refactor|perf|docs|style|test|ci|build|app|brain)(\([^)]*\))?:\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatTime(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(typeof ts === 'number' ? ts : ts);
  if (isNaN(d.getTime())) return '';
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((todayStart - msgStart) / 86400000);
  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return `Yesterday ${timeStr}`;
  if (diffDays < 7) {
    const dayName = d.toLocaleDateString([], { weekday: 'short' });
    return `${dayName} ${timeStr}`;
  }
  const dateLabel = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${dateLabel} ${timeStr}`;
}

// threadTimes — a thread head's "when": the topic's start (its root post) → its last message, in the browser's local
// time (Oren, 26 Oct 2026: "add the time to every thread"). Compact for a phone: "10:28 → 11:42" on one day; a short day
// ("Sat", or "Oct 12" past a week) on a time that is not today; the end carries its own day only when it is a
// different day from the start. One time when there is no later message (or it came the same minute).
const tsDate = (ts) => {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? null : d;
};
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export function threadTimes(startTs, lastTs, now = new Date()) {
  const a = tsDate(startTs);
  if (!a) return '';
  const b = tsDate(lastTs);
  const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (d) => (dayStart(now) - dayStart(d) < 6 * 86400000
    ? d.toLocaleDateString([], { weekday: 'short' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }));
  const startStr = (dayStart(a) === dayStart(now) ? '' : day(a) + ' ') + clock(a);
  if (!b || b.getTime() <= a.getTime() || clock(b) === clock(a) && dayStart(b) === dayStart(a)) return startStr;
  return `${startStr} → ${dayStart(b) === dayStart(a) ? '' : day(b) + ' '}${clock(b)}`;
}

// A live "how long have I been waiting" counter. Seconds granularity while it
// matters (the first minute ticks 1s… 2s…), then m/s, then h/m for long waits.
export function fmtWait(secs) {
  const t = Math.max(0, Math.floor(secs));
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

// The working pulse (Oren, 12 Oct: "a sign that things are moving, every 10 seconds"). The relay keeps ONE entry per
// room in its own doc, `elad-oren-config/pulse` (kernel2/relay-logic.mjs PULSE_DOC): `{ [roomId]: { rootId, atMs, tool,
// steps, what } }`, at most one write per 10 s and only when the model's stream moved. It is never on a message, so a pulse
// never re-renders the room's list (review of #709: a 10 s re-render lost the director's selection and open menu).
// pulseFor reads the entry for one thread; the 1 s ticker fills the row's slot with pulseLine, e.g.
// "step 12 · Run the unit tests · 4s ago" — `what`, the step in the model's own words (relay-logic activityOf), in
// place of the bare tool name when the relay knows it (Oren, 13 Oct). A stream that went quiet shows its age growing — the honest signal, never an animation.
export function pulseFor(doc, roomId, rootId) {
  const p = doc && roomId ? doc[roomId] : null;
  if (!p || !rootId || p.rootId !== rootId || !Number.isFinite(Number(p.atMs)) || !Number(p.atMs)) return null;
  return { atMs: Number(p.atMs), tool: p.tool ? String(p.tool) : '', steps: Math.max(0, Math.floor(Number(p.steps) || 0)), what: p.what ? String(p.what).split('\n')[0].slice(0, 80) : '' };
}
export const pulseTool = (name) => String(name || '').replace(/^mcp__/, '').replace(/__/g, ' ').replace(/_/g, ' ').trim().slice(0, 32);
export function pulseLine(p, nowMs = Date.now()) {
  if (!p || !Number(p.atMs)) return '';
  const tool = p.what || pulseTool(p.tool);
  return [p.steps ? `step ${p.steps}` : 'started', tool, `${fmtWait((nowMs - Number(p.atMs)) / 1000)} ago`].filter(Boolean).join(' · ');
}
// nowLine — the live line under a working thread's 10-min silence note ("Still working on this (11 min so far)…"),
// which is posted once and so goes stale: "Now: Run the unit tests · 4s ago", refreshed by the 1 s ticker from the
// same pulse entry. Empty when the relay does not know the step (the note's own words stand).
export function nowLine(p, nowMs = Date.now()) {
  if (!p || !p.what || !Number(p.atMs)) return '';
  return `Now: ${p.what} · ${fmtWait((nowMs - Number(p.atMs)) / 1000)} ago`;
}
// liveNoteId — the thread's LAST silence note (kernel2/watch-logic.mjs NOTE_KIND): the one row that carries nowLine,
// so a thread with several notes shows the live line once. null when the thread has none.
export function liveNoteId(replies = []) {
  for (let i = replies.length - 1; i >= 0; i--) if (replies[i]?.m?.kind === 'silence-note') return replies[i].id;
  return null;
}

// Splits text at sentence boundaries so each chunk is ≤ maxLen chars
// (Google TTS clips anything over ~200 chars).
export function splitChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const result = [];
  let rest = text.trim();
  while (rest.length > maxLen) {
    // Prefer cutting after sentence-ending punctuation
    let i = maxLen;
    while (i > 0 && !/[.!?]/.test(rest[i - 1])) i--;
    if (!i) { i = maxLen; while (i < rest.length && rest[i] !== ' ') i++; }
    result.push(rest.slice(0, i).trim());
    rest = rest.slice(i).trim();
  }
  if (rest) result.push(rest);
  return result;
}

// ── attachment classification (composer) ──
// Decide how to handle a picked/dropped file, by MIME type AND by filename
// extension. The extension fallback matters: files chosen from Google Drive or
// a documents picker often arrive with an empty or generic type, so a recording
// like "meeting.m4a" would otherwise be rejected. Returns 'image' | 'audio' |
// 'text' | null (null = unsupported). Audio and video share the 'audio' kind —
// both are uploaded as a recording for the relay to transcribe.
export function classifyAttachment(name = '', type = '') {
  const ext = ((name.match(/\.([a-z0-9]+)$/i) || [, ''])[1] || '').toLowerCase();
  if (type.startsWith('image/') || /^(png|jpe?g|gif|webp|heic|heif|bmp|svg|avif)$/.test(ext)) return 'image';
  if (type.startsWith('audio/') || type.startsWith('video/') ||
      /^(m4a|mp3|wav|aac|ogg|oga|opus|weba|webm|mp4|m4v|mov|aif|aiff|flac|amr|3gp|3gpp|mkv|caf|wma)$/.test(ext)) return 'audio';
  if (type.startsWith('text/') || type === 'application/pdf' ||
      /^(txt|md|csv|json|srt|vtt|docx|pdf|rtf|log)$/.test(ext)) return 'text';
  // Anything else (xlsx, zip, any binary/unknown) is still accepted — it gets
  // uploaded as a generic file and the relay/Cleo fetches it. Directors never
  // think about formats or sizes.
  return 'file';
}

// ── an uploaded text file is a FILE on Drive, not only a paste (Oren, 13 Oct 2026) ──
// Before: a .txt/.md/.csv/.json/.srt/.vtt/.docx/.pdf up to 150,000 chars was pasted into the message text and never
// saved anywhere. A 100k-char meeting transcript (room justin, 13 Oct) became one giant message; two hours later the
// room's Cleo said it could not read it again — "it was pasted as a message and not saved as a file". Now every text
// upload goes to Drive first (the same uploadToDriveDirect road every other file takes) and carries a structured
// `driveFiles` entry; the message keeps a readable copy only while it is short.
//
// TEXT_INLINE_MAX = 20,000 chars: the page size of the seat's read_drive_doc (one call reads the whole file back),
// about 5k tokens — a size a turn and a chat bubble both carry comfortably. Above it a PLAIN-text file (whose Drive
// copy read_drive_doc returns verbatim) is shown as its first TEXT_HEAD_CHARS + the Drive link. A .docx/.pdf keeps
// its extracted text inline up to the old 150k cap even when it is on Drive: read_drive_doc returns a Drive
// .docx/.pdf as raw bytes, not text, so the inline copy is still the only readable one (follow-up, see the PR).
// When the Drive upload fails, the message is what it was before — the text inline up to 150k — and says so.
export const TEXT_INLINE_MAX = 20000;
export const TEXT_INLINE_FALLBACK_MAX = 150000;
export const TEXT_HEAD_CHARS = 3000;

// isPlainTextFile — true when the file's Drive copy reads back as the same text (not a .docx/.pdf container).
export function isPlainTextFile(name = '', type = '') {
  if (/\.(docx|pdf)$/i.test(name) || type === 'application/pdf' || /officedocument/.test(type)) return false;
  return true;
}

// driveLink / driveFileEntry — the one shape a Drive upload is recorded in on a message
// (`driveFiles: [{id, name, mimeType, size, webViewLink}]`, read by drive-ingest, transcribe-ingest and the card's
// file chip). No id → no entry (a Drive reply without an id is not a file Cleo can find again).
export function driveLink(up) {
  return (up && up.webViewLink) || (up && up.id ? `https://drive.google.com/file/d/${up.id}/view` : '');
}
// `sha256` is the hash of the bytes the director attached (sha256OfFile), so the Mac's archiver proves the copy it
// makes is the same file; `inlineCopy` marks an image whose compressed preview already rides the message (`images`):
// nothing for drive-ingest to read or post, only an original for the archive.
export function driveFileEntry(up, { name = '', type = '', size = 0, sha256 = null, inlineCopy = false } = {}) {
  if (!up || !up.id) return null;
  return {
    id: up.id, name: up.name || name, mimeType: type || 'file', size: size || 0, webViewLink: driveLink(up),
    ...(sha256 ? { sha256 } : {}), ...(inlineCopy ? { inlineCopy: true } : {}),
  };
}

// ── the raw-file archive (ADR-2610131900ra; Oren, 13 Oct 2026) ──
// Every file a director attaches — images included — leaves the browser as its ORIGINAL bytes: to Drive when Drive
// takes it, else to the 72 h courier. The message records where (driveFiles / courierFiles) and the sha256 of what
// was attached; the Mac's archiver (sidecars/attachment-archive.mjs) copies it, byte-identical and read-only, into
// Cleo's Drive archive and writes the receipt back onto the message (a driveFiles entry with archived:true).
export const HASH_MAX_BYTES = 256 * 1024 * 1024;   // above this the browser does not hold the whole file to hash it

// sha256Hex — hex sha256 of an ArrayBuffer / typed array (WebCrypto: the browser and Node alike).
export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// sha256OfFile — the sha256 of a File/Blob, or null when it is over HASH_MAX_BYTES or unreadable (the archiver then
// hashes what it fetched; only the attach-time cross-check is lost).
export async function sha256OfFile(file) {
  try {
    if (!file || !(file.size >= 0) || file.size > HASH_MAX_BYTES) return null;
    return await sha256Hex(await file.arrayBuffer());
  } catch { return null; }
}

// courierFileEntry — the structured record of a file Drive refused and the courier took (the 📎 line stays for the
// reader; this is what the archiver reads). No 32-hex key → no entry.
export function courierFileEntry({ name = '', type = '', size = 0, sha256 = null, recKey = '', origin = '', inlineCopy = false } = {}) {
  if (!/^[0-9a-f]{32}$/.test(String(recKey || ''))) return null;
  return {
    recKey, origin, name: name || 'upload', mimeType: type || '', size: size || 0,
    ...(sha256 ? { sha256 } : {}), ...(inlineCopy ? { inlineCopy: true } : {}),
  };
}

// filesExtra — the message fields an attach pass adds: only the non-empty arrays.
export function filesExtra({ driveFiles = [], courierFiles = [] } = {}) {
  return { ...(driveFiles.length ? { driveFiles } : {}), ...(courierFiles.length ? { courierFiles } : {}) };
}

// archiveReceipts(m) → [{ name, href, kb, readOnly, verified }] — the archive copies recorded on a message, ready to
// render as the room's receipt ("🗄 name — archived, read-only"). Only an https Drive link survives.
export function archiveReceipts(m = {}) {
  return (Array.isArray(m.driveFiles) ? m.driveFiles : [])
    .filter((f) => f && f.archived === true)
    .map((f) => {
      let href = String(f.webViewLink ?? '').trim();
      if (!/^https:\/\//i.test(href)) href = f.id ? `https://drive.google.com/file/d/${encodeURIComponent(String(f.id))}/view` : '';
      if (!href) return null;
      const kb = Number(f.size) > 0 ? Math.max(1, Math.round(Number(f.size) / 1024)) : 0;
      return { name: String(f.name ?? '').trim() || 'file', href, kb, readOnly: f.readOnly === true, verified: f.verified === true };
    })
    .filter(Boolean);
}

// receiptLabel — the one line a receipt reads as.
export function receiptLabel(r = {}) {
  return `\u{1F5C4} ${r.name} — archived${r.readOnly ? ', read-only' : ''}${r.verified ? ', verified' : ''}`;
}

// fileUploadedLine — the 📎 line for a file that went to Drive (or, with `courier`, to the 24 h courier store).
export function fileUploadedLine({ name = '', type = '', size = 0, link = '', courier = null } = {}) {
  const kb = Math.max(1, Math.round((size || 0) / 1024));
  const head = `\u{1F4CE} [file] ${name} (${type || 'file'}, ${kb} KB) — uploaded`;
  if (courier) return `${head}. Fetch: ${courier.origin}/api/eo-recording?key=${courier.recKey}&part=0 (parts=${courier.parts}; metadata at &part=meta). Download and use as needed.`;
  return `${head} to Drive.${link ? ` ${link}` : ''} Cleo will pick it up and process it.`;
}

// textUploadPart — PURE: what one uploaded text file adds to the message, given what was read out of it and what
// Drive said. `content` is the extracted text (null = unreadable); `drive` is uploadToDriveDirect's reply (null when
// it failed, with `driveError` its message). Returns { text, driveFile } — or { needsCourier: true } when neither a
// Drive copy nor an inline copy is possible (the caller then takes the courier road, exactly as before).
// `courierKept`: Drive refused but the ORIGINAL went to the courier, so the Mac's archiver keeps the file — the inline
// text is a readable copy, not the only one (and the upload reconciler must not rescue it as if it were).
export function textUploadPart({ name = '', type = '', size = 0, content = null, drive = null, driveError = '', courierKept = false } = {}) {
  const driveFile = driveFileEntry(drive, { name, type, size });
  if (driveFile) {
    const link = driveFile.webViewLink;
    if (content === null) return { text: fileUploadedLine({ name, type, size, link }), driveFile };
    const cap = isPlainTextFile(name, type) ? TEXT_INLINE_MAX : TEXT_INLINE_FALLBACK_MAX;
    if (content.length <= cap) return { text: `\u{1F4C4} ${name} — saved to Drive: ${link}\n${content}`, driveFile };
    const n = content.length.toLocaleString('en-US');
    return {
      text: `\u{1F4C4} ${name} — saved to Drive: ${link}\n(${n} chars — too long to paste here. The whole file is on Drive: read it with read_drive_doc and that link. Its first ${TEXT_HEAD_CHARS.toLocaleString('en-US')} chars:)\n${content.slice(0, TEXT_HEAD_CHARS)}\n…`,
      driveFile,
    };
  }
  if (content !== null && content.length <= TEXT_INLINE_FALLBACK_MAX) {
    const why = String(driveError || 'Drive gave no file id').slice(0, 160);
    if (courierKept) return { text: `\u{1F4C4} ${name} — original kept for the archive (Drive refused: ${why}):\n${content}`, driveFile: null };
    return { text: `\u{1F4C4} ${name} (not saved to Drive — ${why}; this message is the only copy):\n${content}`, driveFile: null };
  }
  return { needsCourier: true };
}

// ── composer paste / drop extraction (pure) ──
// Pull the attachable File objects out of a clipboard/drop payload. Used by the
// composer's `paste` and `drop` handlers so all three attach paths (native
// paste, Ctrl+V, drag-and-drop) route through one tested rule. We accept ANY
// file kind (not just images): classifyAttachment above never rejects, so a
// pasted PDF/screenshot/doc all attach. `items` is a DataTransferItemList-like
// array of { kind, getAsFile() }.
export function filesFromClipboardItems(items = []) {
  return [...items]
    .filter((it) => it && it.kind === 'file')
    .map((it) => (typeof it.getAsFile === 'function' ? it.getAsFile() : null))
    .filter(Boolean);
}

// True when the drag payload actually carries files (so we ignore text/link
// drags and don't hijack a plain text selection drop).
export function dragCarriesFiles(dataTransfer) {
  const types = dataTransfer && dataTransfer.types;
  if (!types) return false;
  return (typeof types.includes === 'function')
    ? types.includes('Files')
    : Array.prototype.indexOf.call(types, 'Files') !== -1;
}

// Decide whether a drop/paste needs us to open the bottom-sheet composer first.
// The composer is only visible in two states: the persistent inline composer in
// the `elad-and-oren-chat` room, or when the sheet is already open. In every
// other room a dropped file would stage into a hidden composer (invisible +
// unsendable) — so open the sheet. This is the fix for the prior root cause
// ("composer hidden outside chat-room so no attach affordance").
export function needsComposerOpen({ inChatRoom = false, sheetOpen = false } = {}) {
  return !inChatRoom && !sheetOpen;
}

// Decide whether a room-wide paste should stage the clipboard's files into the
// bottom composer. Ctrl+V fires a `paste` event at the DOM focus, which — unlike
// drag-and-drop — is NOT the room's textarea unless it happens to be focused, so
// a paste must be caught at the document level to work anywhere in the room. Two
// guards: only act when the clipboard actually carries files (a plain-text paste
// into any input is left untouched), and stand down when the paste landed inside
// a thread-reply composer that already has its own attach handler (else the file
// double-stages into both composers). `handledLocally` = the paste target sits
// inside an element that stages the file itself.
export function shouldRoomWidePaste({ hasFiles = false, handledLocally = false } = {}) {
  return hasFiles && !handledLocally;
}

// ── WhatsApp live watch (pure helpers, used by the relay's Green API poller) ──
// Extract human-readable text from a Green API messageData object.
// Returns the text/placeholder, or null for message types we ignore.
export function waMessageText(messageData) {
  if (!messageData) return null;
  switch (messageData.typeMessage) {
    case 'textMessage':         return messageData.textMessageData?.textMessage || null;
    case 'extendedTextMessage':
    case 'quotedMessage':       return messageData.extendedTextMessageData?.text || null;
    case 'imageMessage':        return messageData.fileMessageData?.caption
                                  ? `[photo] ${messageData.fileMessageData.caption}` : '[sent a photo]';
    case 'videoMessage':        return '[sent a video]';
    case 'documentMessage':     return `[sent a file: ${messageData.fileMessageData?.fileName || 'document'}]`;
    case 'audioMessage':        return '[sent a voice message]';
    // Calendar invites, link previews, buttons — extract whatever text is available
    case 'templateMessage':     return messageData.templateMessage?.contentText
                                  || messageData.templateMessage?.footer || '[shared a template]';
    case 'buttonsMessage':      return messageData.buttonsMessage?.contentText || '[shared buttons]';
    case 'listMessage':         return messageData.listMessage?.description || '[shared a list]';
    default: {
      // Best-effort: pull any text field Green API gives us rather than silently dropping
      const d = messageData;
      return d.textMessageData?.textMessage
        || d.extendedTextMessageData?.text
        || d.fileMessageData?.caption
        || null;
    }
  }
}

// A Firestore SDK "INTERNAL ASSERTION FAILED: Unexpected state" (ids ca9/b815
// live inside the watch-stream target aggregator) is a fatal, unrecoverable
// SDK-internal fault: once it fires the realtime listeners are dead and the
// app goes stale until a reload. It is NOT an app-logic bug — nothing in our
// code can prevent it — so the only cure is to detect it and re-establish a
// fresh SDK by reloading. Match defensively on the well-known text.
export function isFatalFirestoreError(msg) {
  const s = String(msg || '');
  return /FIRESTORE/i.test(s) && /INTERNAL ASSERTION FAILED/i.test(s);
}

// Guard the self-heal reload against loops: only reload if we haven't already
// reloaded for this fault within the cool-off window. Returns true to reload.
export function shouldSelfHealReload(nowMs, lastReloadMs, coolOffMs = 60000) {
  if (!lastReloadMs) return true;
  return (nowMs - lastReloadMs) > coolOffMs;
}

// Decide whether an incoming Green API notification body should trigger a room
// turn. Returns { roomId, groupName, sender, text } to act on, or null to skip
// (wrong type, unrouted group, stale backlog, or no usable text).
export function waRouteNotification(body, routes = {}, sinceMs = 0) {
  if (!body || body.typeWebhook !== 'incomingMessageReceived') return null;
  const chatId = body.senderData?.chatId || '';
  const roomId = routes[chatId];
  if (!roomId) return null;
  if ((body.timestamp || 0) * 1000 < sinceMs) return null; // backlog from before startup
  const text = waMessageText(body.messageData);
  if (!text) return null;
  const sender = body.senderData?.senderName || body.senderData?.sender?.split('@')[0] || '?';
  const groupName = body.senderData?.chatName || roomId;
  return { roomId, groupName, sender, text };
}

// ── Draft merge: pick the freshest of a device-local draft and a synced remote one ──
// Each side is { text, at } (at = millis; missing/older side loses). Newer wins so a
// draft typed on one device flows to the other; a tie keeps the local copy. The winner
// may be an explicit clear (empty text) — that must beat an older non-empty draft so a
// sent/cleared message on one device doesn't resurrect stale text on another.
export function pickDraft(local, remote) {
  const la = local && Number.isFinite(local.at) ? local.at : -1;
  const ra = remote && Number.isFinite(remote.at) ? remote.at : -1;
  const winner = ra > la ? remote : local;
  return (winner && typeof winner.text === 'string') ? winner.text : '';
}

// ── Per-author visual identity (console only) ────────────────────────────────
// So a director can tell at a glance WHO wrote a message without reading the small
// grey name, each author gets a stable, subtle accent colour derived from their
// name — deterministic (same name → same colour across reloads, no random assign),
// keyed by the same hash the room swatch uses so the two systems feel of a piece.
// Brain (Cleo) and the director's OWN messages carry their own established styling
// (Cleo's avatar / the "me" bubble), so this is for the fallback avatars — the
// other humans in a room — where every avatar was previously an identical grey
// letter. The palette is intentionally muted (the same one the room filter uses).
export const IDENTITY_PALETTE = ['#5b9bd5','#6cae75','#a17fc0','#d9a441','#5ba8a0','#c0855b','#d4715f','#7a9ec0','#8e8ec0','#c07a9e','#6fae9b','#b58fd0'];
function identityHash(key) {
  let h = 0; for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
// authorColor — a stable accent for an author name. `palette` is injectable for tests.
export function authorColor(name, palette = IDENTITY_PALETTE) {
  const p = (Array.isArray(palette) && palette.length) ? palette : IDENTITY_PALETTE;
  return p[identityHash(name) % p.length];
}
// authorInitial — the single-letter fallback glyph for an avatar (first letter, upper-cased).
export function authorInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : '?';
}

// ── Per-room / per-account avatar image (photo or logo), monogram fallback ───
// A room/account identity may carry a custom `avatar` image (stored on its room
// doc, a small resized data URL). These two pure helpers are the single source
// of truth for "image or monogram" at every place a room/account is drawn — the
// room list swatch, the room header, any identity chip — so the rule is tested
// once and never diverges. The upload/resize + Firestore write are DOM/IO and
// live in the view; the SAFETY + the choice live here.

// avatarSrc — the safe image source for an identity's custom avatar, or '' when
// none or unsafe. ONLY a resized `data:image/*;base64,…` or an `https:` URL is
// allowed — never `javascript:`, `http:` (mixed content) or anything else — so a
// stored value can neither inject script nor downgrade the connection. `maxBytes`
// bounds a data URL so a giant blob (a non-resized upload) is refused, not drawn.
export function avatarSrc(identity, { maxBytes = 200000 } = {}) {
  const v = String((identity && identity.avatar) || '').trim();
  if (!v) return '';
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(v)) return v.length <= maxBytes ? v : '';
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  return '';
}

// avatarMarkup — the identity glyph HTML: the custom image when set & safe, else
// the monogram the caller already builds. Pure string; `esc`, `monogram`, `cls`
// and `alt` are injected so the view owns escaping and its existing swatch/initial.
export function avatarMarkup(identity, { monogram = '', cls = 'avatar-img', esc = (s) => String(s == null ? '' : s), alt = '' } = {}) {
  const src = avatarSrc(identity);
  if (!src) return monogram;
  return `<img class="${esc(cls)}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`;
}

// While a director is typing, a background room update (a new message landing)
// must not steal their scroll position or yank them to a pending card — that's
// what made typed text scroll away and feel lost. These two pure helpers decide
// the post-render scroll behaviour of the message list.

// withOlderPending — a room shows its newest 150 messages, so a card still waiting for a director that is older
// than that window vanished: on 8 Oct 2026 a two-day-old "Open a room for Chen Gabay" approval sat under 292 newer
// #hq messages, unseen and undecidable, while it held every Mac update. The room now also reads its pending cards;
// any not already in the window are merged in at their place in time (oldest first), so the pending counter and
// the jump-to-card button reach them. `tsOf(doc)` → ms. Pure; docs are passed through untouched.
export function withOlderPending(recentDocs = [], pendingDocs = [], tsOf = () => 0) {
  const seen = new Set(recentDocs.map((d) => d.id));
  const older = pendingDocs.filter((d) => !seen.has(d.id) && seen.add(d.id)); // a doc both pending and linked: once
  if (!older.length) return recentDocs;
  // Every pending doc outside the window is older than all of it, so the older ones go first, sorted among
  // themselves; the window keeps the SDK's order untouched (a just-sent message has no server createdAt yet and
  // must not be re-sorted to the top — Fable, 9 Oct).
  return [...older.sort((a, b) => (Number(tsOf(a)) || 0) - (Number(tsOf(b)) || 0)), ...recentDocs];
}

// The "jump to the pending card" convenience is only for ENTERING a room that
// needs input. It must never fire on a later background update (which scrolls
// the view up mid-typing), and never while the director is actively composing.
// A link to a message wins (Oren, 23 Oct 2026: "the link takes me to a random place"): a room entered BY a link lands
// on what the link names, never on the pending card 300 ms later.
export function shouldAutoJumpToPending({ entering = false, pendingCount = 0, composing = false, deepLink = false } = {}) {
  return !!entering && pendingCount > 0 && !composing && !deepLink;
}
// A room entered with nothing waiting on a director opens on the oldest thread this director has not read (Oren, 27 Oct
// 2026: "open the room straight on the first unread thread"). A link and a waiting card win, as above.
export function shouldJumpToUnread({ entering = false, pendingCount = 0, composing = false, deepLink = false, firstUnreadId = null } = {}) {
  return !!entering && !!firstUnreadId && pendingCount === 0 && !composing && !deepLink;
}

// inAppHash — a tapped link that points into this same console (any spelling of its page: `/elad-and-oren/`,
// `/elad-and-oren/index.html`, with or without a query) → its hash, opened in place; anything else → null, a normal
// open. Oren, 23 Oct 2026: a thread link reloaded the whole page (and the 308 from index.html bounced it again)
// instead of opening the thread.
export function inAppHash(href, here) {
  let u, h;
  try { u = new URL(href, here); h = new URL(here); } catch { return null; }
  const page = (p) => p.replace(/\/index\.html$/, '/');
  if (u.origin !== h.origin || page(u.pathname) !== page(h.pathname)) return null;
  return u.hash && u.hash.length > 1 ? u.hash : null;
}

// linkedRootId — the thread a deep link names: `#room/root/answer` names it outright (alt); `#room/mid` names a
// message whose doc says its thread (threadId), or is the root itself. Used to read a thread the newest-150 window
// does not hold.
export function linkedRootId(dh, msg) {
  if (!dh?.mid) return null;
  if (dh.alt) return dh.alt;
  return (msg && msg.threadId) || dh.mid;
}

// Where #msgs should sit after a re-render:
//  • entering a room → the saved scroll offset (or bottom, handled by caller);
//  • composing → hold exactly where we are, so an incoming message never scrolls
//    the text out from under the director;
//  • otherwise → follow new messages to the bottom only if already near it.
export function nextScrollTop({ pendingScrollRestore = null, composing = false, wasNearBottom = false, prevScrollTop = 0, scrollHeight = 0 } = {}) {
  if (typeof pendingScrollRestore === 'number') return pendingScrollRestore;
  if (composing) return prevScrollTop;
  if (wasNearBottom) return scrollHeight;
  return prevScrollTop;
}

// ── Next steps → room status ────────────────────────────────────────────────
// Every room carries a small list of open next steps, kept current by Cleo:
//   { text, owner, due: 'YYYY-MM-DD' | null, done: boolean }
// owner is a director's name, or 'Customer'/'Client' (case-insensitive) for an
// item we're waiting on the customer for. These pure helpers turn that list into
// the room's headline status shown at the top of the room and in the room list.
export function isCustomerOwner(owner) {
  return /^(customer|client)$/i.test(String(owner || '').trim());
}
export function openNextSteps(nextSteps) {
  return (Array.isArray(nextSteps) ? nextSteps : []).filter(s => s && s.text && !s.done);
}
const _NS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  return `${parseInt(m[3], 10)} ${_NS_MONTHS[parseInt(m[2], 10) - 1] || ''}`.trim();
}
// The room's headline status, derived from its open next steps. Returns
// { label, tone, due } or null when nothing is open. tone ∈
//   'action'   — something is on us now (overdue, due today, or undated);
//   'followup' — something is on us but scheduled for a future date;
//   'waiting'  — the ball is entirely in the customer's court.
// Our own work always outranks customer-side waiting, so a room where we owe a
// reply AND await the customer still reads as needing us.
// ── card hyperlinks (the reusable console primitive) ──────────────────────────────────────────────────────
// Every director card MAY carry a structured `links: [{label, url}]` field — a hyperlink to the item the card is
// about (a GitHub issue, a build/PR/deploy, a client thread) — rendered by the shell as a clickable row. The card
// BODY additionally auto-links `[label](url)` markdown + bare http(s) URLs. Both are rendered here so the logic is
// unit-tested and self-contained (an index.html rewrite keeps importing these). XSS-safe: all text is
// HTML-escaped and ONLY http/https URLs ever become anchors — a `javascript:`/`data:`/other-scheme URL is dropped
// (links row) or left as inert escaped text (body). Pure string→string; index.html injects the returned HTML.
const _escHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// isSafeHttpUrl — a URL we are willing to turn into an href: an absolute http:// or https:// URL and nothing else
// (no javascript:, data:, vbscript:, mailto:, relative, or scheme-relative). PURE.
export function isSafeHttpUrl(url) {
  const s = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

// safeCardLinksHtml — render a card's structured `links` into a clickable row. Drops any entry whose URL is not a
// safe http(s) URL (the XSS guard); escapes label + href. Returns '' when there are no renderable links (so a card
// with no links renders exactly as before). PURE.
export function safeCardLinksHtml(links = []) {
  const items = (Array.isArray(links) ? links : [])
    .filter((l) => l && isSafeHttpUrl(l.url))
    .map((l) => {
      const href = _escHtml(String(l.url).trim());
      const label = _escHtml((String(l.label ?? '').trim()) || String(l.url).trim());
      return `<a class="card-link" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
  return items.length ? `<div class="card-links">${items.join('')}</div>` : '';
}

// isolateLtrRuns — wrap each Latin/number run in `<bdi>` so it stops being reordered by the Hebrew
// around it. PURE, and it runs on ALREADY-ESCAPED html.
//
// `unicode-bidi: plaintext` fixes the BLOCK: each line picks its own base direction. It does nothing for
// a Latin phrase INSIDE a Hebrew line — there the bidi algorithm still resolves the neutral characters
// (spaces, commas, parens, `#`) against the surrounding Hebrew, so a line like
// `התיקון חי בייצור (PR #1044, מזוג 22.9)` renders with the number and the bracket in places a reader does not
// expect. `<bdi>` is exactly the fix the standard provides: an isolate, so the run is laid out on its own
// and the Hebrew reads around it. Reported by Oren, 22 Sep 2026 ("the numbers and brackets jump").
//
// A run starts at an optional `#`/`@` plus an alphanumeric, may carry internal spaces and the punctuation
// that binds a phrase together (so `PR #1044, merged 22.9` isolates as ONE run rather than three), and must
// END on an alphanumeric — so trailing spaces and the comma before the Hebrew stay OUTSIDE the isolate.
// BRACKETS ARE DELIBERATELY EXCLUDED. A first cut allowed them, and `(PR #1044, מזוג 22.9 UTC)` isolated
// the closing bracket without its opener — an unbalanced isolate, which reads worse than no isolate at all.
// A bracket around a Hebrew sentence's parenthetical belongs to the Hebrew and mirrors correctly there.
// A leading currency sign and a trailing `%` belong to the number: left outside, `$1,265` rendered as `1,265$`
// and `50%` as `%50` in a Hebrew line (the sign resolved to the Hebrew side of the isolate).
const LTR_RUN = /[#@$€£₪]?[A-Za-z0-9](?:[A-Za-z0-9 ._,:;#@&%+\-\/\\?=!'"$€£₪]*[A-Za-z0-9])?%?/g;
// Segments that must never be touched: an html tag emitted by the caller (a link, <strong>, <code>) and an
// html ENTITY — splitting `&amp;` into `&<bdi>amp</bdi>;` would print the entity instead of the character.
const HTML_ATOM = /(<[^>]*>|&[a-zA-Z]+;|&#\d+;)/;
// Hebrew + Arabic blocks. An all-Latin card has nothing to be reordered BY, so it is returned untouched:
// no isolate is needed, none is emitted, and every existing English card renders byte-identically.
const HAS_RTL = /[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\ufb1d-\ufdff\ufe70-\ufeff]/;
export function hasRtl(text = '') { return HAS_RTL.test(String(text ?? '')); }

// textDir — the base direction of ONE line (or one short block), read from its words. 'rtl' | 'ltr'.
// The browser's own guess (`dir="auto"`, `unicode-bidi: plaintext`) takes the FIRST strong letter, so a Hebrew
// line that opens with a name or a figure — `Renjini רוצה חיפוש…`, `17/08 EFT Settlement $1,265 — קיבוץ…` —
// was laid out left-to-right and read backwards (Cleo, 24 Sep 2026: "the reversed Hebrew"). Here a line is
// Hebrew when its first letter is Hebrew OR at least as many of its words are Hebrew as Latin; it is English
// when Latin words outnumber Hebrew ones and it does not open in Hebrew. A line with no letters at all (a
// figure, a rule, an emoji) takes `fallback` — the direction of the message it sits in. PURE.
const HE_LETTER = /[\u0590-\u05ff\ufb1d-\ufb4f]/;
const LATIN_LETTER = /[A-Za-z\u00c0-\u024f]/;
export function textDir(text = '', fallback = 'ltr') {
  const s = String(text ?? '');
  let he = 0, latin = 0, first = null;
  for (const word of s.split(/\s+/)) {
    if (HE_LETTER.test(word)) he++; else if (LATIN_LETTER.test(word)) latin++;
  }
  for (const ch of s) {
    if (HE_LETTER.test(ch)) { first = 'rtl'; break; }
    if (LATIN_LETTER.test(ch)) { first = 'ltr'; break; }
  }
  if (!he && !latin) return fallback === 'rtl' ? 'rtl' : 'ltr';
  if (first === 'rtl' || he >= latin) return 'rtl';
  return 'ltr';
}

// dirMark — the invisible strong character that pins a line's direction inside a `unicode-bidi: plaintext`
// block (RLM for rtl, LRM for ltr). The block reads each line's direction from its first strong character,
// so one mark at the start of the line makes that read come out as textDir decided. Copy handlers strip it.
export const dirMark = (dir) => (dir === 'rtl' ? '\u200f' : '\u200e');
export const stripDirMarks = (s = '') => String(s ?? '').replace(/[\u200e\u200f]/g, '');

export function isolateLtrRuns(html = '') {
  const src = String(html ?? '');
  if (!HAS_RTL.test(src)) return src;
  return src.split(HTML_ATOM).map((seg, i) => (
    i % 2 === 1 ? seg : seg.replace(LTR_RUN, (run) => `<bdi>${run}</bdi>`)
  )).join('');
}

// splitCardDetails — a card's text cut in two at its checking part (Oren, 19 Oct: the card reads as plain sentences;
// the exact command is one tap away, never gone). `head` is what the card says; `details` is the exact call, from the
// details line down (kernel2/gate-logic DETAILS_HEAD, or the "Details, for checking:" line older cards carry), or ''.
// The details line itself is dropped: the closed box carries its own label. PURE.
export const CARD_DETAILS_HEADS = ['The exact command, for checking:', 'Details, for checking:'];
export function splitCardDetails(text = '') {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => CARD_DETAILS_HEADS.includes(l.trim()));
  if (at < 0) return { head: lines.join('\n'), details: '' };
  return { head: lines.slice(0, at).join('\n').replace(/\s+$/u, ''), details: lines.slice(at + 1).join('\n').replace(/^\s+|\s+$/gu, '') };
}

// linkifyCardBody — escape a card's body text, then render markdown `[label](https…)` links, bare http(s) URLs,
// `**bold**` and `` `code` `` as safe HTML, preserving newlines (the `.card .body` container is white-space:
// pre-wrap). The URL groups are http-only, so a `[x](javascript:…)` markdown or a `javascript:` token is never
// linked — it stays as inert escaped text. Escaping runs FIRST, so a quote/angle-bracket in the text can never
// break out of the emitted attributes or tags. PURE.
// A body with Hebrew in it also gets a direction mark at the start of every line (textDir per line, the whole
// body's direction for a line with no letters), so a Hebrew line that opens with a Latin word or a number is
// still laid out right-to-left; links and code are their own isolates with their own direction. An all-Latin
// body is rendered exactly as before.
export function linkifyCardBody(text = '') {
  const src = String(text ?? '');
  const rtl = hasRtl(src);
  const iso = rtl ? ' dir="auto"' : '';
  const base = rtl ? textDir(src) : 'ltr';
  return src.split('\n').map((line) => {
    let out = _escHtml(line);
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer"${iso}>${label}</a>`);
    out = out.replace(/(^|[\s([{])(https?:\/\/[^\s<>]+)/gi,
      (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer"${iso}>${url}</a>`);
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/`([^`\n]+)`/g, `<code${iso}>$1</code>`);
    // LAST, so it only ever sees finished html: every Latin run becomes its own bidi isolate.
    out = isolateLtrRuns(out);
    return rtl && line.trim() ? dirMark(textDir(line, base)) + out : out;
  }).join('\n');
}

// Focus mode (director ask, coo-build, 7 Sep 2026): fully hide the room list so the current room
// takes the whole window — one tap to hide, one tap to restore. The DECISION is pure and lives here
// (index.html applies the returned classes / localStorage ops); this is what makes the device-width
// branching and the persistence unit-testable rather than DOM-only.
export const SIDEBAR_FOCUS_BREAKPOINT = 720;

// focusToggleAction — what a burger tap should do. On mobile (<= breakpoint) the room list is already
// an off-canvas drawer, so the tap just toggles the drawer (mode:'drawer'); index.html keeps its
// existing toggleSidebar there. On desktop it toggles the full-hide 'sidebar-collapsed' class, which
// is mutually exclusive with the rail — so a hide also clears the rail. Returns the class ops + the
// persistence the caller must apply, and the new burger title, so nothing about the effect is hidden
// in the DOM handler.
export function focusToggleAction({ width, hasFocus } = {}) {
  if ((width ?? Infinity) <= SIDEBAR_FOCUS_BREAKPOINT) return { mode: 'drawer' };
  const nowHidden = !hasFocus;
  return {
    mode: 'focus',
    hidden: nowHidden,
    // Hiding: add 'sidebar-collapsed', clear the mutually-exclusive rail. Showing: drop 'sidebar-collapsed'.
    addClasses: nowHidden ? ['sidebar-collapsed'] : [],
    removeClasses: nowHidden ? ['sidebar-rail'] : ['sidebar-collapsed'],
    setStorage: { 'eo-sidebar-focus': nowHidden ? '1' : '0' },
    removeStorage: nowHidden ? ['eo-sidebar-rail'] : [],
    burgerTitle: nowHidden ? 'Show the room list' : 'Hide the room list — focus on this room',
  };
}

// restoreSidebarState — which sidebar classes to apply on load, given the persisted flags and the
// current width. Focus (full hide) is desktop-only and WINS over rail if both were ever set (they are
// mutually exclusive at toggle time; this keeps a load-time guarantee too). On mobile, focus is
// ignored (the drawer is the mechanism) and rail does not apply either.
export function restoreSidebarState({ width, rail, focus } = {}) {
  const desktop = (width ?? Infinity) > SIDEBAR_FOCUS_BREAKPOINT;
  if (desktop && focus === '1') {
    return { classes: ['sidebar-collapsed'], burgerTitle: 'Show the room list' };
  }
  if (desktop && rail === '1') {
    return { classes: ['sidebar-rail'], burgerTitle: null };
  }
  return { classes: [], burgerTitle: null };
}

export function deriveRoomStatus(nextSteps, todayISO) {
  const open = openNextSteps(nextSteps);
  if (!open.length) return null;
  const ours = open.filter(s => !isCustomerOwner(s.owner));
  const theirs = open.filter(s => isCustomerOwner(s.owner));
  if (ours.length) {
    const earliest = ours.map(s => s.due).filter(Boolean).sort()[0] || null;
    if (!earliest || earliest <= todayISO) return { label: 'Action needed', tone: 'action', due: earliest };
    return { label: `Follow-up by ${fmtDue(earliest)}`, tone: 'followup', due: earliest };
  }
  const earliest = theirs.map(s => s.due).filter(Boolean).sort()[0] || null;
  return { label: 'Waiting for customer', tone: 'waiting', due: earliest };
}

// ── machineDigest — fold the Builder's machine-facing output to one line (ADR-0220) ─────────────────────────────
// Cleo, 24 Sep 2026: a Builder post in a room — the CLEO-VERDICT line and its JSON, merge-resolution detail, the
// suite count — filled the whole screen, because the newest long message in a room opens by itself. The build room
// is deliberately exempt from the tone filter (shas and paths belong there), so this is a SHAPE fix in the console:
// such a post renders folded, as one summary line, and opens only when she taps it.
//
// Returns null when the message renders as usual, else { summary, verdict } for the folded line. A post is folded
// when it is a brain post that carries a CLEO-VERDICT line (any persona), or a long Builder post. A post that asks
// her something is never folded: its last prose line ends in a question mark. Cards (question/approval/decision)
// never reach here — they render through their own path, so what needs a tap stays in view.
// The line format is the one kernel/build-report-logic.mjs parseVerdictTail reads; this is a display read only, so
// it keeps the fields a reader needs and never gates anything.
export const DIGEST_MIN_CHARS = 300;
const DIGEST_VERDICT_RE = /^\s*CLEO-VERDICT:\s*(\{.*\})\s*$/i;
const DIGEST_SUMMARY_MAX = 140;

export function parseVerdictLine(text = '') {
  const lines = String(text ?? '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = DIGEST_VERDICT_RE.exec(lines[i]);
    if (!m) continue;
    try {
      const v = JSON.parse(m[1]);
      if (v && typeof v.verdict === 'string') return { verdict: v.verdict, blockedOn: v.blockedOn ? String(v.blockedOn) : null };
    } catch { /* a malformed verdict line is still a verdict line; it just carries no badge */ }
    return { verdict: null, blockedOn: null };
  }
  return null;
}

export function verdictBadge(v) {
  if (!v || !v.verdict) return '';
  const word = { built: 'Built', 'already-fixed': 'Already fixed', blocked: 'Blocked' }[v.verdict] || v.verdict;
  return v.blockedOn ? `${word} · waits on ${v.blockedOn}` : word;
}

export function machineDigest(m) {
  if (!m || m.from !== 'brain' || m.type) return null;
  const text = String(m.text || '');
  const verdict = parseVerdictLine(text);
  if (!verdict && !(m.persona === 'builder' && text.length > DIGEST_MIN_CHARS)) return null;
  const prose = text.split('\n').filter((l) => !DIGEST_VERDICT_RE.test(l)).map((l) => l.trim()).filter(Boolean);
  if (prose.length && /[?？]\s*$/.test(prose[prose.length - 1])) return null; // it asks her something — leave it open
  const first = (prose[0] || '').replace(/[*_`#>]/g, '').trim();
  const sentence = (first.match(/^.*?[.!?](?=\s|$)/) || [first])[0];
  const summary = sentence.length > DIGEST_SUMMARY_MAX ? sentence.slice(0, DIGEST_SUMMARY_MAX - 1).trimEnd() + '…' : sentence;
  return { summary: summary || 'Build detail', verdict: verdictBadge(verdict) };
}

// ── handoffWake — a machine handoff is a status event, not a message (ADR-0232) ────────────────────────────────
// Cleo, 24 Sep 2026 ("it look bad and adds noise on screen"): when one seat hands work to another, the kernel writes a
// wake nudge into the target room (eventWakeMessage, kernel/events-logic.mjs). It is written as 'Cleo' so ingress runs
// a turn on it, which also made the rooms app treat it as a director's message: it rooted a thread whose title was the
// raw plumbing ("[handoff] build-done from builder pick up…") and whose first row was a Cleo bubble. machineDigest
// (ADR-0220) never saw it, because it only reads brain posts. The nudge carries nothing a person reads (the payload
// rides the event), so the thread is titled by what came of it and the nudge itself is one quiet status line.
//
// Returns null for anything that is not a handoff wake, else { label, from }: a plain name for the event type and the
// seat that sent it. The text format is the one eventWakeMessage writes; `kind: 'event-wake'` is the stamp. Display only.
const HANDOFF_TEXT_RE = /^\s*\[handoff\]\s+(\S+)\s+from\s+(\S+)/i;
const HANDOFF_LABELS = {
  'build-done': 'Build finished', 'build-request': 'Build requested', 'invoice-request': 'Invoice requested',
  'client-signal': 'Client update', 'qa-verdict': 'QA verdict', 'answer-ready': 'Answer ready',
};
const SEAT_NAMES = { builder: 'Builder', qa: 'QA', coo: 'COO', cfo: 'CFO', ceo: 'Strategy', account: 'Cleo', general: 'Cleo' };

export function handoffWake(m) {
  if (!m || (m.type && m.type !== 'text')) return null;
  const hit = HANDOFF_TEXT_RE.exec(String(m.text || ''));
  if (!hit && m.kind !== 'event-wake') return null;
  const type = hit ? hit[1].toLowerCase() : 'event';
  const seat = hit ? hit[2].replace(/[^\w-].*$/, '').toLowerCase() : '';
  const label = HANDOFF_LABELS[type] || (type === 'event' ? 'Handoff' : type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, ' '));
  return { label, from: SEAT_NAMES[seat] || (seat && seat !== '?' ? seat : null) };
}

// handoffLine — the one line a handoff reads as, wherever it shows ("Build finished · from Builder").
export function handoffLine(hw) {
  return hw ? hw.label + (hw.from ? ' · from ' + hw.from : '') : '';
}

// threadTitle — the one title every thread surface shows (the thread row, Working now).
// The relay's own title wins (kernel2 goal-logic parseGoal: Cleo names the thread in 2–5 words on every turn, and renames
// it as the subject moves); a handoff-rooted thread is named by the first sentence of what the seat said back, else by the
// handoff's label; every other thread keeps the first words of its trigger. A director's own name for the thread
// (`names` = the room doc's `threadNames`, set by a double-click, Oren 11 Oct) wins over all of these.
export function threadTitle(trigger, replies = [], names = null) {
  const m = trigger?.m || {};
  const named = cleanName(names?.[trigger?.id]);
  if (named) return named;
  const own = String(m.title || '').trim();
  if (own) return own;
  const wa = waWatchTitle(m);
  if (wa) return wa;
  const em = emailTitle(m);
  if (em) return em;
  const hw = handoffWake(m);
  if (!hw) return uiAskTitle(m.text) || taskTitle(m.text);
  const said = replies.find((e) => e?.m?.from === 'brain' && !e.m.type && String(e.m.text || '').trim());
  const first = said ? String(said.m.text).split('\n').map((l) => l.replace(/[*_`#>]/g, '').trim()).find(Boolean) || '' : '';
  const sentence = (first.match(/^.*?[.!?:—–](?=\s|$)/) || [first])[0].replace(/\s*[.!?:—–]$/, '');
  return taskTitle(sentence) || hw.label;
}

// uiAskTitle — a 🎯 request's thread, until Cleo names it (the relay's `title`, from the turn's TITLE line): '🎯 <the ask>',
// never the 23-character "UI change requested:" banner every one of them opens with (Oren, 22 Oct: "short and easy to read").
export function uiAskTitle(text = '') {
  const s = String(text || '');
  return s.startsWith(UI_REQUEST_PREFIX) ? taskTitle('🎯 ' + s.slice(UI_REQUEST_PREFIX.length)) : '';
}

// waWatchTitle — the head of a WhatsApp-watch message. adapters/whatsapp-greenapi/watch.mjs opens every flush with
// its instruction to Cleo, '(Live from WhatsApp — group "justin". Handle per the WHATSAPP WATCH rules: …)', and
// that read as the thread's title (Oren, 13 Oct). The title says what it is and who spoke:
// '📱 WhatsApp · justin group · Justin: hi …'. '' when the message is not a watch flush.
export const WA_WATCH_HEADER_RX = /^\(Live from WhatsApp\s*[—–-]\s*group\s*"([^"]*)"[^\n]*\)\s*\n?/;
export function waWatchTitle(m = {}) {
  const text = String(m?.text || '');
  const g = text.match(WA_WATCH_HEADER_RX);
  if (!g) return '';
  const first = taskTitle(text.slice(g[0].length));
  return `📱 WhatsApp · ${g[1] || 'group'} group${first ? ` · ${first}` : ''}`;
}

// ── Inbound email runs (Oren, 12 Oct 2026: "I don't need so many threads when messages arrive in a row — less noise") ──
// Each inbound email roots its own thread (its threadId is 'email:<gmail id>', never a console message id). A thread
// that holds nothing but inbound email is an "email-only" item; a run of two or more of them next to each other in the
// ordered timeline — nothing from a director or Cleo in between — becomes ONE item:
//   { type: 'emails', id: 'emails:<first trigger id>', items: [task…], status, senders: [name…], lastTs }
// Only a QUIET email joins a run (status in EMAIL_RUN_QUIET: read, nothing owed). An email Cleo is still working on,
// one that needs a push (never read → notpicked), or any other live state is its own row and breaks the run, so a
// collapsed run never hides anything that wants a director. The run's status is its most urgent member's, in
// EMAIL_RUN_QUIET's order (fyi before done).
// Anything else (a thread Cleo answered, a director's ask, a standalone note) breaks the run and is left untouched.
export const EMAIL_RUN_QUIET = ['fyi', 'done'];
export const isEmailOnlyItem = (it) => !!it && it.type === 'task'
  && [it.trigger, ...(it.replies || [])].every((e) => isInboundEmail(e?.m) || e?.m?.kind === 'activity');

// The sender's short name from the doc: senders[0].name ("Michal <michal@…>") or the header line
// "(Email to Cleo's inbox. From: Elad Shultz <Elad@…>." → "Michal", "Elad". A bare address gives its local part.
export function emailSenderName(m = {}) {
  return emailSenderFull(m).split(/\s+/)[0];
}
// The sender's whole display name ("GSA Planning", "Halina Rubenstein"); a bare address gives its local part.
export function emailSenderFull(m = {}) {
  const raw = String(m.senders?.[0]?.name || (String(m.text || '').match(/From:\s*([^\n]*?)\.\s*(?:Handle|To reply|\))/) || [])[1] || '').trim();
  if (!raw) return '';
  const display = raw.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (display) return display;
  const addr = (raw.match(/<?([^<>@\s]+)@/) || [])[1];
  return addr || raw;
}

// emailHead — an inbound email thread's row (Oren, 23 Oct 2026: "dry and boring and serves no purpose"): the row read
// the watch's instruction to Cleo, "(Email to Cleo's inbox. From: … Handle per WHATSAPP WATCH rules …". It now reads
// who wrote and about what: { who: 'GSA Planning', subject: 'Site plans' }. The subject is the email's "Subject:" line,
// else the first words of its body. null when the message is not an inbound email.
export function emailHead(m = {}) {
  if (!isInboundEmail(m)) return null;
  const text = String(m.text || '');
  const who = emailSenderFull(m) || 'Email';
  const subj = (text.match(/^Subject:[ \t]*(.*)$/m) || [])[1] || '';
  const body = text.includes('\n---\n') ? text.slice(text.indexOf('\n---\n') + 5) : '';
  const subject = taskTitle(subj.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '')) || taskTitle(body.replace(/^\s+/, '')) || '(no subject)';
  return { who, subject };
}
export function emailTitle(m = {}) {
  const h = emailHead(m);
  return h ? `📧 ${h.who} · ${h.subject}` : '';
}

// rsvpLine — a calendar answer to an invite ("Accepted: Lunch … @ Tue 27 Oct 2026 12pm - 1pm (AEDT) (cleo@…)") is not a
// conversation (Oren, 26 Oct 2026: "a whole thread only for an acceptance?"). Its thread draws as ONE quiet line:
// { verb: 'accepted'|'declined'|'tentative', who: 'Justin', event: 'Lunch before the JD meeting…', when: 'Tue 27 Oct 12pm' }.
// The email and Cleo's note stay inside, a tap away. null when the thread's first message is not an RSVP email, or when
// it waits on a director (that stays a full thread, never hidden in a line).
export const RSVP_SUBJECT_RX = /^(Accepted|Declined|Tentatively accepted):\s*(.+)\s+@\s+(.+?)(?:\s*\([^()]*\))*\s*$/i;
// Only a quiet thread folds: anything that is stuck, held, unread by Cleo or waits on a director keeps its full row.
export const RSVP_QUIET = ['done', 'fyi', 'pending', 'archived'];
export function rsvpLine(item = {}) {
  const m = item.trigger?.m;
  if (!isInboundEmail(m) || !RSVP_QUIET.includes(item.status || 'pending')) return null;
  const subj = (String(m.text || '').match(/^Subject:[ \t]*(.*)$/m) || [])[1] || '';
  const r = subj.trim().match(RSVP_SUBJECT_RX);
  if (!r) return null;
  const verb = /^acc/i.test(r[1]) ? 'accepted' : /^dec/i.test(r[1]) ? 'declined' : 'tentative';
  const when = r[3].replace(/\s+\d{4}\b/, '').replace(/\s+-\s+.*$/, '');
  return { verb, who: emailSenderName(m) || 'Someone', event: r[2], when };
}
// ── An inbound email, drawn like a chat message (Oren, 26 Oct 2026: "filter all the text I don't need to read in
// emails … only the text that matters", like the WhatsApp bubbles). emailView(m) → { who, subject, text, rsvp, cut }:
// the watch's instruction to Cleo, the Subject line, the quoted earlier mail ("On … wrote:"), the greeting and the
// sign-off, mail footers and HTML entities are dropped; hard-wrapped lines are rejoined. A calendar answer
// (rsvpLine's subject) also reads its event: { verb, event, when, where, mapUrl, note }. `cut` = lines dropped, so the
// row can offer the original. null when the message is not an inbound email.
const MAIL_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const MAIL_CUT_RX = [
  /^On [^\n]*\d[^\n]{0,200}?(?:\n[^\n]{0,120})?wrote:\s*$/m,  // Gmail's quote header (it carries a date), often on two lines
  /^-{2,}\s*(?:Original|Forwarded) [Mm]essage/m, /^From: [^\n]+\n(?:Sent|Date): /m,
  /^~~\/\/~~/m, /^Invitation from Google Calendar/m, /^You are receiving this/m,
  /^Sent from my /m, /^Get Outlook for /m, /^-- $/m,
];
const GREETING_RX = /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^\n]{0,60}$/i;
const SIGNOFF_RX = /^(?:thanks|thank you|many thanks|cheers|regards|kind regards|best|best regards|warm regards|talk soon)[ ,.!]*$/i;
export function cleanEmailBody(body = '', { name = '' } = {}) {
  let t = String(body || '').replace(/\r\n?/g, '\n').replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => MAIL_ENTITIES[e]);
  for (const rx of MAIL_CUT_RX) { const i = t.search(rx); if (i >= 0) t = t.slice(0, i); }
  let lines = t.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => !/^>/.test(l));
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length > 1 && GREETING_RX.test(lines[0].trim())) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // the sign-off: "Thanks" / "Cheers," and the name under it, in the last three lines. Cut only when what follows looks
  // like a signature (short name-like lines: no digits, no sentence marks), never a "PS: …" or a last instruction.
  const sigLike = (l) => !l.trim() || (l.trim().split(/\s+/).length <= 4 && !/[\d.:?!]/.test(l));
  for (let i = Math.max(1, lines.length - 3); i < lines.length; i++) {
    if (SIGNOFF_RX.test(lines[i].trim()) && lines.slice(i + 1).every(sigLike)) { lines = lines.slice(0, i); break; }
  }
  // a bare name under the last line ("…any questions.\nJustin") is the signature too
  if (name && lines.length > 1 && lines[lines.length - 1].trim().toLowerCase() === name.toLowerCase()) lines.pop();
  // rejoin hard wraps: a long line followed by more prose is one sentence the mailer broke at ~72 characters
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && prev.length >= 60 && !/:\s*$/.test(prev) && l.trim() && !/^\s*([-*•]|\d+[.)])\s/.test(l)) out[out.length - 1] = `${prev} ${l.trim()}`;
    else out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
// A mail's inline pictures (signature logos, pasted screenshots: image001.png) and a calendar's invite.ics are shown as
// pictures or not at all, never as a file line; a real attachment (a .docx, a .pdf) keeps its line.
export const MAIL_INLINE_FILE_RX = /^(?:image\d*\.(?:png|jpe?g|gif)|invite\.ics)$/i;
export const mailFiles = (m = {}) => (Array.isArray(m.driveFiles) ? m.driveFiles : []).filter((f) => !MAIL_INLINE_FILE_RX.test(String(f?.name || '')));
export function emailView(m = {}) {
  if (!isInboundEmail(m)) return null;
  const raw = String(m.text || '');
  const subject = ((raw.match(/^Subject:[ \t]*(.*)$/m) || [])[1] || '').trim();
  const body = raw.includes('\n---\n') ? raw.slice(raw.indexOf('\n---\n') + 5) : raw.replace(/^\(Email to Cleo's inbox[^\n]*\)\n?/, '');
  const who = emailSenderFull(m) || 'Email';
  const r = subject.match(RSVP_SUBJECT_RX);
  let rsvp = null;
  let text;
  if (r) {
    const b = body.replace(/\r\n?/g, '\n').replace(/&amp;/g, '&');
    const head = b.split(/^(?:Organiser|Organizer|Guests)\s*$/m)[0];
    const where = (head.match(/^Location\s*\n\s*([^\n]+?)\s*$/m) || [])[1] || '';
    const mapUrl = (head.match(/^Location\s*\n[^\n]*\n\s*(https?:\/\/\S+)/m) || [])[1] || '';
    const day = (head.match(/^[^\n]*⋅[^\n]*$/m) || [''])[0].replace(/\s*⋅\s*/, ' · ').replace(/\s+\d{4}\b/, '').trim();
    const drop = new Set([r[2].trim(), where, mapUrl, 'Location', 'Join with Google Meet'].filter(Boolean));
    const note = cleanEmailBody(head.split('\n').filter((l) => {
      const s = l.trim();
      return !drop.has(s) && !/has (?:accepted|declined|tentatively accepted) this invitation/i.test(s)
        && !s.includes('⋅') && !/Time - /.test(s) && !/^https?:\/\/meet\.google\.com/.test(s);
    }).join('\n'));
    const verb = /^acc/i.test(r[1]) ? 'accepted' : /^dec/i.test(r[1]) ? 'declined' : 'tentative';
    rsvp = { verb, event: r[2].trim(), when: day || r[3].replace(/\s+\d{4}\b/, ''), where, mapUrl, note };
    text = note;
  } else text = cleanEmailBody(body, { name: who.split(/\s+/)[0] });
  const cut = Math.max(0, body.split('\n').filter((l) => l.trim()).length - text.split('\n').filter((l) => l.trim()).length);
  return { who, subject: subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, ''), text, rsvp, cut, raw: body.replace(/\r\n?/g, '\n').trim() };
}
export const RSVP_WORD = { accepted: 'accepted', declined: 'declined', tentative: 'said maybe to' };
export const RSVP_MARK = { accepted: '✓', declined: '✗', tentative: '?' };

// plainLine — a reply as one plain line for a row's preview: no markdown marks (**, __, `, #, >), no line breaks.
export function plainLine(text = '') {
  return String(text || '').replace(/\*\*|__|`+/g, '').replace(/^\s*(#{1,6}|>)\s*/gm, '')
    .replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function groupInboundEmails(items = [], { min = 2 } = {}) {
  const rank = (s) => EMAIL_RUN_QUIET.indexOf(s);
  return foldRuns(items, {
    min,
    joins: (it) => isEmailOnlyItem(it) && EMAIL_RUN_QUIET.includes(it.status),
    build: (run) => {
      const senders = [];
      for (const it of run) {
        const n = emailSenderName(it.trigger.m);
        if (n && !senders.includes(n)) senders.push(n);
      }
      const status = run.reduce((b, it) => (rank(it.status) < rank(b) ? it.status : b), run[0].status);
      return { type: 'emails', id: `emails:${run[0].trigger.id}`, items: run, status, senders,
        lastTs: Math.max(...run.map((it) => itemActivity(it))) };
    },
  });
}

// foldRuns — the one "a run of these is one row" mechanism (inbound emails, WhatsApp-watch flushes). Walks the ordered
// feed; an item `joins` a run, and the run continues while `sameRun(previous, item)` holds; anything else breaks it. A run
// of at least `min` becomes ONE item, `build(run)`; a shorter one is left as its items. The order never changes.
export function foldRuns(items = [], { joins, sameRun = () => true, build, min = 2 }) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length && run.length >= min) out.push(build(run)); else out.push(...run);
    run = [];
  };
  for (const it of items) {
    if (joins(it)) {
      if (run.length && !sameRun(run[run.length - 1], it)) flush();
      run.push(it);
      continue;
    }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

// "📧 7 emails · Michal, Elad" — at most three names, then "+N".
export function emailRunTitle(group) {
  const n = group?.items?.length || 0;
  const names = group?.senders || [];
  const who = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
  return `📧 ${n} emails${who ? ` · ${who}` : ''}`;
}

// ── A WhatsApp chat is ONE thread (Oren, 15 Oct 2026, #justin: "Every case you have a chat conversation, consolidate
// into one thread. Display only … I can always start a new thread and the next convo will be a new thread of chats.
// It always shows the same thread behaviour of a new message inside the same thread, just designed as a WhatsApp
// message instead of a Cleo regular message.") ──
// Display only: the backend is untouched. Every watch flush (adapters/whatsapp-greenapi/watch.mjs) still roots its own
// thread and gets its own turn: its doc id is the root, its threadId the room's stable 'wa:<room>', and Cleo's answer
// (threadId 'wa:<room>' too) attaches to the newest flush by adjacency (clusterMessages). Here, a run of such threads
// next to each other in the ordered feed, from the same chat, is drawn as ONE ordinary thread item:
//   { type: 'task', trigger: <earliest flush>, replies: [every other entry of the run, in time order], status,
//     wa: { chat, threadId, members: [flush root ids], replyTo: <newest flush id>, title, clearable } }
// so renderTask draws it like every thread (head, status, sort place, open/close, reply box); only the flush messages
// inside it are drawn as WhatsApp bubbles. Anything else between two flushes (a director's new thread, a note) ends the
// chat thread; the next flushes start a new one. A single flush is a chat thread too (min 1).
// Nothing is hidden by the fold: a pending card, a director's reply, Cleo's answers all render inside the thread, and the
// thread's status is its most urgent member's (a pending card reads "Needs you", and a "Needs you" thread opens itself).
// The reply box posts to the newest flush's thread, so the backend sees an ordinary reply in an existing thread.
// A watch flush: the watch's header line opens the text. Without the header the body cannot be read as "Name: text".
export const isWaWatchFlush = (m) => !!m && (m.source === 'whatsapp' || m.from === '📱 WhatsApp')
  && WA_WATCH_HEADER_RX.test(String(m.text || ''));
export const waChatName = (m) => (String(m?.text || '').match(WA_WATCH_HEADER_RX) || [])[1] || '';
export const isWaFlushItem = (it) => !!it && it.type === 'task' && isWaWatchFlush(it.trigger?.m);

// waWatchLines — a flush's body as the chat lines it carried: [{ sender, text }], header dropped. The watch writes one
// "Sender: text" line per message, but a message may itself span lines; a line that does not open with a known sender
// (m.senders, else any short "Name:" head) continues the line above.
export function waWatchLines(m = {}) {
  const text = String(m?.text || '');
  const g = text.match(WA_WATCH_HEADER_RX);
  const body = g ? text.slice(g[0].length) : text;
  const known = (m.senders || []).map((s) => String(s?.name || '').trim()).filter(Boolean);
  const out = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const hit = known.length
      ? known.find((n) => line.startsWith(`${n}:`))
      : (line.match(/^([^:\n]{1,40}):\s/) || [])[1];
    if (hit) out.push({ sender: hit.trim(), text: line.slice(hit.length + 1).trim() });
    else if (out.length) out[out.length - 1].text += (line ? `\n${line}` : '\n');
    else if (line.trim()) out.push({ sender: '', text: line.trim() });
  }
  return out.map((l) => ({ ...l, text: l.text.replace(/\n+$/, '') })).filter((l) => l.text);
}

// A chat thread's status: its most urgent member's. Anything not named here ranks first, so an unknown state is never
// quietened by the fold.
export const WA_STATUS_RANK = ['waiting', 'stuck', 'notpicked', 'replied-awaiting', 'working', 'pending', 'paused', 'on-hold', 'fyi', 'done'];
const waTs = (e) => { const c = e?.m?.createdAt; const ms = c ? (c.toMillis?.() ?? +c) : NaN; return Number.isFinite(ms) ? ms : Infinity; };

// waChatTitle — '📱 WhatsApp · justin group · Elad Shultz: you have all the fixes now…': the chat, then its last message.
export function waChatTitle(newest = {}) {
  const lines = waWatchLines(newest);
  const last = lines[lines.length - 1];
  const said = last ? taskTitle(last.sender ? `${last.sender}: ${last.text}` : last.text) : '';
  return `📱 WhatsApp · ${waChatName(newest) || 'group'} group${said ? ` · ${said}` : ''}`;
}

export function waChatThread(run = []) {
  const rank = (s) => { const i = WA_STATUS_RANK.indexOf(s); return i < 0 ? -1 : i; };
  const status = run.reduce((b, it) => (rank(it.status) < rank(b) ? it.status : b), run[0].status);
  const byTime = (a, b) => waTs(a) - waTs(b);
  const roots = run.map((it) => it.trigger).sort(byTime);
  const trigger = roots[0];
  const newest = roots[roots.length - 1];
  const replies = run.flatMap((it) => [it.trigger, ...it.replies]).filter((e) => e !== trigger)
    .map((e, i) => [e, i]).sort(([a, ai], [b, bi]) => byTime(a, b) || ai - bi).map(([e]) => e);
  return {
    type: 'task', trigger, replies, status,
    wa: {
      chat: waChatName(trigger.m), threadId: trigger.m.threadId || '', members: roots.map((e) => e.id), replyTo: newest.id,
      title: waChatTitle(newest.m), clearable: run.every((it) => it.status === 'done' || it.status === 'fyi'),
    },
  };
}

export function groupWhatsAppRuns(items = []) {
  return foldRuns(items, {
    min: 1,
    joins: isWaFlushItem,
    sameRun: (a, b) => a.trigger.m.threadId === b.trigger.m.threadId && waChatName(a.trigger.m) === waChatName(b.trigger.m),
    build: waChatThread,
  });
}

// waWindow — what a chat thread shows when it opens: its last `cap` WhatsApp messages (a flush is never cut in half, and
// Cleo's words between them come along), and never less than an undecided card: a pending card is always on screen.
// `entries` is the thread oldest-first ([trigger, ...replies], each { m }). → { shown: entries visible from the end,
// hidden: WhatsApp messages above them, behind "Earlier messages" }.
export const WA_SHOWN = 50;
const waCount = (m) => (isWaWatchFlush(m) ? Math.max(1, waWatchLines(m).length) : 0);
export function waWindow(entries = [], { cap = WA_SHOWN } = {}) {
  let n = 0;
  let i = entries.length;
  while (i > 0 && n < cap) {
    const k = waCount(entries[i - 1]?.m);
    if (k && n && n + k > cap) break;
    n += k;
    i--;
  }
  const card = entries.findIndex((e) => e?.m && PENDING_CARD(e.m));
  if (card >= 0 && card < i) i = card;
  const hidden = entries.slice(0, i).reduce((s, e) => s + waCount(e?.m), 0);
  return { shown: entries.length - i, hidden };
}

// gatherWaChats — in creation order a WhatsApp chat's later flushes would sit after the threads opened since, and
// groupWhatsAppRuns (which folds only ADJACENT flushes) would show one chat as several threads. Each later flush of a
// chat moves up to just after that chat's previous flush, so the chat stays one thread, in the place it started.
// Nothing else moves.
export function gatherWaChats(items = []) {
  const chatOf = (it) => (isWaFlushItem(it) ? `${it.trigger.m.threadId || ''}\u0000${waChatName(it.trigger.m)}` : null);
  const out = [];
  const lastAt = new Map(); // chat → its newest flush's index in `out`
  for (const it of items) {
    const chat = chatOf(it);
    if (chat == null || !lastAt.has(chat)) {
      out.push(it);
      if (chat != null) lastAt.set(chat, out.length - 1);
      continue;
    }
    const at = lastAt.get(chat) + 1;
    out.splice(at, 0, it);
    for (const [k, v] of lastAt) if (v >= at) lastAt.set(k, v + 1);
    lastAt.set(chat, at);
  }
  return out;
}

// groupFeedRuns — the room feed's folds, in one place: inbound-email runs, then WhatsApp chat threads.
export const groupFeedRuns = (items = []) => groupWhatsAppRuns(groupInboundEmails(items));

// cleanName — a name a director typed for a room or a thread (double-click to rename, Oren 11 Oct: "like in Claude"):
// trimmed, inner whitespace collapsed, at most 80 characters. '' means "no name" — the caller keeps the old one.
export const NAME_MAX = 80;
export function cleanName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

// ── 🎯 "Change something" (9 Oct 2026, Oren) ────────────────────────────────────────────────────────────────
// A director taps 🎯, picks one element on the screen and writes what should change. The console posts ONE ordinary
// director message (sendMsg — the normal send path) into the Boss room, whose text is built here, so Boss has
// everything it needs to find the element in the code: where, which element, its text, a short CSS path and how it
// looks now. elementDescriptor packs a DOM element (or any object with the same few fields — the unit specs pass
// plain objects); describeTarget names it in human words; uiRequestMessage writes the message.
// contextMenuChoice — what a right-click opens (Oren, 12 Oct: "make feedback a right-click again — on top of the browser's
// options, first"). A page cannot add an item to the browser's own menu, so the console opens its own small menu with
// 🎯 Feedback first, and leaves the browser's menu alone wherever that menu is the point: a message whose own menu took
// the click (its quick actions carry 🎯 first), a text field (Paste), selected text (Copy), a second right-click while
// ours is open, pick mode, a touch screen, or no signed-in director. 'feedback' = open ours; 'browser' = do nothing.
export function contextMenuChoice({ handled, editable, hasSelection, menuOpen, picking, finePointer = true, signedIn = true } = {}) {
  return handled || editable || hasSelection || menuOpen || picking || !finePointer || !signedIn ? 'browser' : 'feedback';
}
export const UI_REQUEST_ROOM = 'hq2';
export const UI_REQUEST_PREFIX = '🎯 UI change requested: ';
export const CONSOLE_FILE = 'app/console/public/elad-and-oren/index.html';

const _oneLine = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const _classesOf = (el) => {
  const raw = el?.classList ? [...el.classList] : String(typeof el?.className === 'string' ? el.className : '').split(/\s+/);
  return raw.filter((c) => c && !c.startsWith('ui-pick-'));   // never our own pick-mode outline class
};
// one CSS step: tag, #id when there is one, and the first two classes
const _step = (el) => {
  const tag = String(el?.tagName || '').toLowerCase() || '?';
  const id = el?.id ? '#' + el.id : '';
  const cls = _classesOf(el).slice(0, 2).map((c) => '.' + c).join('');
  return tag + id + cls;
};

// elementDescriptor(el, getStyle?) → { tag, id, classes, text, label, role, path, color, background, fontSize }.
// The path is at most 4 steps, element last, and stops early at an ancestor with an id (that already pins it).
// getStyle defaults to the browser's getComputedStyle; in node, with none given, the look fields are ''.
export function elementDescriptor(el, getStyle) {
  if (!el) return null;
  const tag = String(el.tagName || '').toLowerCase();
  const attr = (n) => (typeof el.getAttribute === 'function' ? el.getAttribute(n) : null) || '';
  const steps = [];
  for (let n = el; n && steps.length < 4 && String(n.tagName || '').toLowerCase() !== 'html'; n = n.parentElement) {
    steps.unshift(_step(n));
    if (n.id && n !== el) break;
  }
  const gs = getStyle || (typeof getComputedStyle === 'function' ? getComputedStyle : null);
  let st = null; try { st = gs ? gs(el) : null; } catch { st = null; }
  const text = _oneLine(/^(input|textarea|select)$/.test(tag) ? '' : (el.innerText ?? el.textContent), 80);   // never what a director typed
  const role = attr('role') || ({ button: 'button', a: 'link', input: 'field', textarea: 'text box', select: 'menu',
    img: 'image', label: 'label', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading',
    h6: 'heading', li: 'list item', ul: 'list', ol: 'list', p: 'paragraph', svg: 'icon' })[tag] || '';
  const label = _oneLine(attr('aria-label') || attr('title') || attr('placeholder') || attr('alt') || text, 40);
  return {
    tag, id: el.id || '', classes: _classesOf(el), text, label, role, path: steps.join(' > '),
    color: st?.color || '', background: st?.backgroundColor || '', fontSize: st?.fontSize || '',
  };
}

// describeTarget — the target in human words: the "Send" button · the "Message the room…" text box · the #msgs area.
export function describeTarget(d) {
  if (!d) return 'this spot';
  const kind = d.role || 'area';
  if (d.label) return `the "${d.label}" ${kind}`;
  if (d.id) return `the #${d.id} ${kind}`;
  return `the ${d.tag || 'page'} ${kind}`;
}

// uiRequestMessage — the one text a 🎯 request posts. First line is always `🎯 UI change requested: <ask>`; null when
// there is no ask (the console does not send an empty request). `file` names the code to change (the dashboard page
// passes its own).
export function uiRequestMessage({ ask, descriptor, room, screen, file = `${CONSOLE_FILE} (pure helpers in logic.js)` } = {}) {
  const a = String(ask || '').trim();
  if (!a) return null;
  const d = descriptor || {};
  const el = (d.tag || '?') + (d.id ? '#' + d.id : '') + (d.classes || []).map((c) => '.' + c).join('');
  const look = [d.color && `color ${d.color}`, d.background && `background ${d.background}`, d.fontSize && `font-size ${d.fontSize}`]
    .filter(Boolean).join(' · ');
  return [
    UI_REQUEST_PREFIX + a,
    `Where: room ${room || '(none)'} · screen ${screen || '(none)'}`,
    `Element: ${describeTarget(d)} — <${el}>`,
    `Its text: ${d.text ? '"' + _oneLine(d.text, 80) + '"' : '(none)'}`,
    `CSS path: ${d.path || '(unknown)'}`,
    `Looks now: ${look || '(unknown)'}`,
    `Console file: ${file} — change, test, PR.`,
  ].join('\n');
}

// The dashboard's 🎯 feedback (Oren, 21 Oct: "there is no feedback button inside the dashboard") is this same request,
// posted to Boss the same way, naming the dashboard's files so Boss changes the right code.
export const DASHBOARD_FILE = 'app/console/public/elad-and-oren/dashboard.html (dashboard.js; pure helpers in dashboard-logic.mjs)';
export const dashboardFeedbackMessage = ({ ask, descriptor, screen } = {}) =>
  uiRequestMessage({ ask, descriptor, room: 'dashboard', screen, file: DASHBOARD_FILE });

// ── Earlier context in a thread (Oren, 12 Oct 2026) ─────────────────────────────────────────────────────────────
// A thread opens on its latest message. Looking further up is asking "what led to this?", so the reveal goes one
// EXCHANGE at a time, not five messages at a time: the message just above the visible ones, plus the director's ask
// right before it when that message is Cleo's answer — never more than two messages a click. The button names the
// step ("Oren's ask and Cleo's answer") and previews it in one line, so the director decides whether to open it
// before any full text appears. Activity strips ride along with the step that contains them and never count.
// `entries` is the whole thread oldest-first (the trigger, then the replies), each { from, kind, text };
// `shown` is how many entries at the end are visible.
const CONTEXT_PREVIEW_CHARS = 80;
const isCleoSide = (e) => !e || e.kind === 'activity' || AGENT_SENDERS.has(e.from) || e.from === 'Cleo';
const entryWho = (e) => (isCleoSide(e) ? 'Cleo' : (e.from || 'Director'));

export function contextPreview(text, max = CONTEXT_PREVIEW_CHARS) {
  const one = String(text == null ? '' : text).replace(/^\[Voice[^\]]*\]\n?/i, '').replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + '…' : one;
}

// How many entries a thread shows when it opens: the last one, or the last two when the last one is a relay notice
// (⚠️ usage limit, ⏳ queued, 🔄 retrying) — a notice alone says nothing about what it is a notice about. A thread of
// just the ask and one answer shows both, as it always has.
export function defaultShown(entries = []) {
  const n = entries.length;
  if (n <= 2) return n;
  const last = String(entries[n - 1]?.text || '').trimStart();
  return /^(⚠️|⏳|🔄)/u.test(last) ? 2 : 1;
}

// How many entries are visible given what the thread remembers: nothing remembered (a fresh thread, or Collapse,
// which forgets) means the default view — `base`, defaultShown unless the thread has its own (a WhatsApp chat thread's
// waWindow); a remembered count is clamped to the thread (1e9 = everything).
export function shownCount(stored, entries = [], base = defaultShown(entries)) {
  return Math.min(entries.length, stored || base);
}

// The next step up from `shown`, or null when everything is visible.
// → { count, label, preview, remaining }: reveal `count` more entries; `remaining` stay hidden after that.
export function contextStep(entries = [], shown = 1) {
  const n = entries.length;
  const b = n - Math.max(0, Math.min(n, shown)); // index of the first visible entry
  if (b <= 0) return null;
  let i = b - 1;
  while (i > 0 && entries[i]?.kind === 'activity') i--; // a strip rides along with the message above it
  const picked = [i];
  if (isCleoSide(entries[i])) {
    let j = i - 1;
    while (j >= 0 && entries[j]?.kind === 'activity') j--;
    if (j >= 0 && !isCleoSide(entries[j])) { picked.unshift(j); i = j; }
  }
  const first = entries[picked[0]];
  const label = picked.length === 2
    ? `${entryWho(first)}'s ask and Cleo's answer`
    : (isCleoSide(first) ? "Cleo's earlier reply" : `${entryWho(first)}'s ask`);
  const preview = contextPreview(first?.text) || (first?.kind === 'activity' ? 'Working steps' : '');
  return { count: b - i, label, preview, remaining: i };
}

// ── Reply notifications (Oren, 12 Oct 2026: "Chrome notifications every time there's an answer I was waiting for;
// a click takes me to the answer"). The Mac sends them (kernel2/reply-notify-logic.mjs); these are the console's half.

// pushDeviceKey — the key this browser's push token is stored under in `elad-oren-push/<Name>.devices`, so each of a
// director's browsers is its own device. MUST equal kernel2/reply-notify-logic.mjs deviceKey (a test holds them equal).
export function pushDeviceKey(token = '') {
  return String(token).slice(-24).replace(/[^A-Za-z0-9_]/g, '_');
}

// parseDeepHash — `#room/msg` (a shared link) or `#room/threadRoot/answer` (a reply notification) → what to open:
// `mid` is the message to scroll to (the answer when named), `alt` the thread root to fall back to, `answer` true for a
// notification's link (its highlight says "Cleo answered", not "Shared with you"). `focus` is true whenever the link
// names a message: it lands on that message alone (focusView), not the whole thread (Oren, 15 Oct 2026).
export function parseDeepHash(hash = '') {
  const [rid = '', a = '', b = ''] = String(hash).replace(/^#/, '').split('/');
  if (!rid) return null;
  if (b) return { rid, mid: b, alt: a || null, answer: true, focus: true };
  return { rid, mid: a || null, alt: null, answer: false, focus: !!a };
}

// focusView — a notification or a message link lands on THAT message alone (Oren, 15 Oct 2026: "When I tap a
// notification it opens the whole thread. I want to see only the message I tapped, not scroll a lot."). `entries` is
// the thread oldest-first as the console holds it, [{ id, m }] (the trigger, then the replies); `targetId` the message
// the link names. → null when there is nothing to focus (not in this thread, or it IS the thread's first message: the
// thread opens as before), else { targetId, shown, context, hidden, after }:
//   shown    the ids that stay on screen: the message, and every undecided card in the thread — a focus never hides
//            what waits on a director (the same keep-cards rule as waWindow; Fable's review of #800)
//   context  one line of what the message replies to: the nearest message above it from the other side (a director's
//            ask above Cleo's answer, Cleo's answer above a director's reply), else the nearest one with words;
//            activity strips and wordless rows never count. A WhatsApp flush reads as its last chat line.
//            → { id, who, preview } or null
//   hidden   how many rows "Show the whole thread" brings back — only rows that draw something
//   after    how many messages sit below the tapped one. The caller keeps it from the landing render and passes it back
//            as `opts.after`: once more arrive (Cleo's next answer, the director's own reply) the focus is over and the
//            thread reads as usual (null) — a focus never hides a new message.
export function focusView(entries = [], targetId = '', { after = null } = {}) {
  const i = targetId ? entries.findIndex((e) => e?.id === targetId) : -1;
  if (i <= 0) return null;
  const below = entries.length - 1 - i;
  if (after != null && below > after) return null;
  const side = (e) => isCleoSide({ from: e.m?.from, kind: e.m?.kind });
  const said = (e) => {
    const m = e.m || {};
    if (m.kind === 'activity' || m.type === 'secret') return null;
    if (isWaWatchFlush(m)) {
      const last = waWatchLines(m).pop();
      return last ? { who: last.sender || 'WhatsApp', text: last.text } : null;
    }
    const text = contextPreview(m.text);
    return text ? { who: entryWho({ from: m.from, kind: m.kind }), text } : null;
  };
  const mine = side(entries[i]);
  let near = null;
  for (let j = i - 1; j >= 0; j--) {
    const s = said(entries[j]);
    if (!s) continue;
    const pick = { id: entries[j].id, who: s.who, preview: contextPreview(s.text) };
    if (side(entries[j]) !== mine) { near = pick; break; }
    near = near || pick;
  }
  const shown = entries.filter((e, k) => k === i || (e?.m && PENDING_CARD(e.m))).map((e) => e.id);
  const draws = (m = {}) => !!(String(m.text || '').trim() || (Array.isArray(m.images) && m.images.length)
    || m.kind === 'activity' || ['question', 'approval', 'align', 'secret'].includes(m.type));
  const hidden = entries.filter((e) => !shown.includes(e.id) && draws(e.m)).length;
  return { targetId, shown, context: near, hidden, after: below };
}

// pushAskState — what the console shows for notifications: nothing once Chrome allows them ('on'), a small bell to
// ask with a click when it has not been asked ('ask' — never an automatic prompt), a struck bell when Chrome blocks them.
export function pushAskState(permission) {
  if (permission === 'granted') return 'on';
  if (permission === 'denied') return 'blocked';
  return 'ask';
}

// replyShowHere — a reply notification that arrives while a console tab is visible comes to the page, not the
// service worker: draw it unless the director is looking at that very room in a focused window.
export function replyShowHere({ data = {}, focused = false, visible = false, roomId = null } = {}) {
  if (data.kind !== 'cleo-reply') return false;
  return !(focused && visible && roomId && roomId === data.room);
}

// doormanRunLine — what a doorman card's line says about its run (kernel2/doorman.mjs writes `ran`). A run that
// finished: ✓ sent / ⚠️ not confirmed (the send may have gone) / ✗ failed. A run the doorman lost mid-way (`ran.lost`,
// no end recorded, never re-run) says so: nothing on the line would read as fine. No run yet: nothing.
export function doormanRunLine(ran) {
  if (!ran || typeof ran !== 'object') return '';
  if (ran.lost === true && !ran.at) return ' · ⚠️ stopped mid-way, not confirmed';
  if (!ran.at) return '';
  return ran.ok ? ' · ✓ sent' : ran.ambiguous ? ' · ⚠️ not confirmed' : ' · ✗ failed';
}

// deliveryLine — ADR-2610230900st: the one delivery state a WhatsApp send carries on its own approval card (`delivery`,
// written by the kernel's send and moved by the WhatsApp watcher), as the plain-Hebrew words a director reads after the
// decision: ' · ✓ נשלח' / ' · ✓ נמסר' / ' · ✓ נקרא' / ' · ✓ ענה' / ' · ⏳ עוד לא בצ׳אט' / ' · ✗ לא הגיע'. '' when the card has
// none. The kernel's copy of the words is adapters/whatsapp-greenapi/logic.mjs DELIVERY_HE; a spec pins them equal.
export const DELIVERY_WORDS = Object.freeze({ pending: 'עוד לא בצ׳אט', sent: 'נשלח', delivered: 'נמסר', read: 'נקרא', replied: 'ענה', failed: 'לא הגיע' });
export function deliveryLine(delivery) {
  const state = delivery && typeof delivery === 'object' ? delivery.state : null;
  const words = DELIVERY_WORDS[state];
  if (!words) return '';
  const mark = state === 'failed' ? '✗' : state === 'pending' ? '⏳' : '✓';
  return ` · ${mark} ${words}`;
}

// isUnshownCard — a scheduled card (kernel/card-tools.mjs, `showAt`) is a `type:'question'` doc stored at once with
// `status:'scheduled'`; the sweep flips it to pending at its time. Until then, and for ever once cancelled before
// it, the room transcript must not draw it: the seat was told "the directors won't see it before then" (PR #824).
export function isUnshownCard(m) {
  return !!m && m.type === 'question' && (m.status === 'scheduled' || m.status === 'cancelled') && 'showAt' in m;
}

// briefingView — what the Boss room shows the signed-in director (ADR-2610180409dq; Oren, card 46PFgdarnADe6CkvGda1,
// 18 Oct 2026: "when I open Boss I see one thing, not the threads"). `entries` are `{ id, m }` from the room's own
// listeners (the newest messages, the pending cards) plus his latest briefing thread; `rootId` is his row on
// `elad-oren-config/briefing`. Returns his briefing's replies (Cleo's messages in that thread, oldest first),
// `building` while the briefing turn has not answered, and his live cards: the ones that briefing raised first, in the
// order raised (most important first), then any other card waiting in the room, newest first. A card for the other
// director is not his. Pure; a later entry with the same id wins (the thread listener is the fresher read).
export const BRIEFING_ROOM = 'hq2';
const CARD_TYPES = new Set(['question', 'approval', 'decision', 'align']);
export function briefingView(entries = [], { me = '', rootId = null } = {}) {
  const byId = new Map();
  for (const e of entries) if (e?.id && e.m) byId.set(e.id, e);
  const all = [...byId.values()];
  const ms = (e) => { const c = e.m.createdAt; return c ? (c.toMillis?.() ?? Number(c)) || 0 : 0; };
  const root = (rootId && byId.get(rootId)) || null;
  const inThread = (e) => !!rootId && e.m.threadId === rootId;
  const replies = all.filter((e) => inThread(e) && e.m.from === 'brain' && !CARD_TYPES.has(e.m.type)).sort((a, b) => ms(a) - ms(b));
  const live = all.filter((e) => PENDING_CARD(e.m) && !isUnshownCard(e.m) && (!e.m.for || e.m.for === me));
  const cards = [
    ...live.filter(inThread).sort((a, b) => ms(a) - ms(b)),
    ...live.filter((e) => !inThread(e)).sort((a, b) => ms(b) - ms(a)),
  ];
  return { root, building: !!root && !root.m.answeredAt && !root.m.failedAt, replies, cards };
}

// waitingForMe — the "מחכה לך · N" list pinned on top of the room list (Oren, 19 Oct 2026: "I want to always see every
// task still waiting for me, in short, so I tap one and move it on; the tap takes me to its room, its thread").
// `entries` are `{ roomId, id, m }`, every room's pending card docs (one listener per room, index.html watchWaiting).
// A card counts exactly as briefingView counts it: PENDING_CARD, not a scheduled/cancelled one, and for him or for
// nobody in particular. Returns `[{ roomId, msgId, text, ageMs }]`, newest first; `text` is the card's question (Boss's
// decide.mjs card), else its title (the pipeline's cards), else the first line of its text (a gate card), cut at
// WAITING_TEXT_MAX with an ellipsis. Pure; a later entry with the same room+id wins.
export const WAITING_TEXT_MAX = 60;
const oneLine = (s) => String(s || '').split('\n').map((l) => l.replace(/^[#>\s]+/, '').replace(/[*`]/g, '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
export function waitingText(m = {}) {
  const t = oneLine(m.question) || oneLine(m.title) || oneLine(m.text);
  return t.length > WAITING_TEXT_MAX ? t.slice(0, WAITING_TEXT_MAX - 1).trimEnd() + '…' : t;
}
export function waitingForMe(entries = [], { me = '', nowMs = Date.now() } = {}) {
  const byKey = new Map();
  for (const e of entries) if (e?.roomId && e.id && e.m) byKey.set(`${e.roomId}/${e.id}`, e);
  // a card just written has no server time yet: it is the newest, age 0
  const ms = (m) => { const c = m.createdAt; return (c ? (c.toMillis?.() ?? Number(c)) || 0 : 0) || nowMs; };
  return [...byKey.values()]
    .filter((e) => PENDING_CARD(e.m) && !isUnshownCard(e.m) && (!e.m.for || e.m.for === me))
    .map((e) => ({ roomId: e.roomId, msgId: e.id, text: waitingText(e.m), ageMs: Math.max(0, nowMs - ms(e.m)), at: ms(e.m) }))
    .sort((a, b) => b.at - a.at)
    .map(({ at, ...it }) => it);
}

// waitAge — a card's age in the list's few letters: "עכשיו", "5ד" (minutes), "3ש" (hours), "2י" (days).
export function waitAge(ms = 0) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `${m}ד`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}ש` : `${Math.floor(h / 24)}י`;
}

// briefingSections — the briefing summary as a page, not a wall of text (Oren, 18 Oct 2026: "make it nicer to read,
// graphically friendly"). Boss writes `בשורה אחת: …` then `## <section>` headings with `- <head>: <body>` items and an
// optional `המלצה: …` line under an item (kernel2/rooms/hq2/briefing.md § 5). An older briefing with no `##` still
// parses when its paragraphs open with a known section name and a colon ("מחכה לך (…):"). Returns
// `{ lead, sections: [{ title, note, kind, items: [{ head, body, rec }] }] }` (`note` is a heading's closing
// parenthesis), or null when there is no section at all (the
// console then shows the message as before). Pure; text only — the console escapes every piece.
const BRIEFING_KINDS = [
  ['since', /^מאז שהסתכלת/], ['other', /^מה \S+ (עשה|החליט)/], ['waiting', /^מחכה לך/],
  ['answered', /^נראה שכבר נענה/], ['next', /^מה אני עושה עכשיו/],
];
const briefingKind = (title) => (BRIEFING_KINDS.find(([, re]) => re.test(title)) || ['note'])[0];
export function briefingSections(text = '') {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const sections = [];
  let lead = ''; let sec = null; let item = null;
  const open = (full) => {
    const n = /^(.*?)\s*\(([^()]*)\)$/.exec(full);
    const title = n ? n[1] : full;
    sec = { title, note: n ? n[2] : '', kind: briefingKind(title), items: [] }; sections.push(sec); item = null;
  };
  // the first colon outside parentheses that ends a word ("מאז שהסתכלת (20:44):" → the one after the parenthesis)
  const headColon = (s) => {
    let depth = 0;
    for (let i = 0; i < s.length && i <= 80; i++) {
      const c = s[i];
      if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === ':' && !depth && (i + 1 === s.length || /\s/.test(s[i + 1]))) return i;
    }
    return -1;
  };
  const split = (s) => {
    const at = headColon(s);
    return at > 0 && at <= 70 && s.slice(at + 1).trim() ? { head: s.slice(0, at).trim(), body: s.slice(at + 1).trim() } : { head: '', body: s };
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { item = null; continue; }
    const h = /^#{1,3}\s+(.+)$/.exec(line);
    if (h) { open(h[1].trim()); continue; }
    const l = /^(?:בשורה אחת|בקצרה)\s*:\s*(.+)$/.exec(line);
    if (l && !sec) { lead = l[1]; continue; }
    const at = /^[-•*]\s/.test(line) ? -1 : headColon(line);
    if (at > 1 && briefingKind(line.slice(0, at).trim()) !== 'note') {
      open(line.slice(0, at).trim());
      const rest = line.slice(at + 1).trim();
      if (rest) { item = { head: '', body: rest, rec: '' }; sec.items.push(item); }
      continue;
    }
    const rec = /^המלצה(?: שלי)?\s*:\s*(.+)$/.exec(line);
    if (rec && item) { item.rec = rec[1]; continue; }
    const b = /^[-•*]\s+(.+)$/.exec(line);
    if (!sec) { if (b || lead) { open(''); } else { lead = lead ? `${lead} ${line}` : line; continue; } }
    if (b) { item = { ...split(b[1]), rec: '' }; sec.items.push(item); continue; }
    if (item) item.body = item.body ? `${item.body} ${line}` : line;
    else { item = { head: '', body: line, rec: '' }; sec.items.push(item); }
  }
  for (const s of sections) for (const it of s.items) {
    const r = /^(.*?)\s*ההמלצה(?: שלי)?:\s*(.+)$/.exec(it.body);
    if (!it.rec && r && r[1]) { it.body = r[1]; it.rec = r[2]; }
  }
  return sections.some((s) => s.title) ? { lead, sections: sections.filter((s) => s.title || s.items.length) } : null;
}

// briefingItemCard — the live card a briefing item speaks of, so its buttons sit right under the item (Oren, 19 Oct
// 2026: "I want the decision buttons right here, or a link that jumps to where the question is"). Boss names a card
// by its first words in quotes and its room in parentheses (briefing.md § 5: `- "<first words>" (חדר <room>): …`).
// `cards` are `{ id, room, m }`, the pending cards of the rooms the briefing names. Returns `{ room, card }`: `card` is
// the one whose text or title holds those words (in that room, when one is named), else null; `room` is the room the
// item names, for a link, else ''. Pure.
const cardWords = (s) => String(s || '').toLowerCase().replace(/[\u2018\u2019\u05f3`]/g, "'").replace(/[\u201c\u201d\u05f4]/g, '"')
  .replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
export function briefingItemCard(item = {}, cards = []) {
  const at = `${item.head || ''} ${item.body || ''}`;
  const r = /\(\s*חדר\s+([\w-]+)/.exec(at);
  const room = r ? r[1] : '';
  const q = /["\u201c\u201d\u05f4]([^"\u201c\u201d\u05f4]{6,})["\u201c\u201d\u05f4]/.exec(item.head || '');
  if (!q) return { room, card: null };
  const words = cardWords(q[1]).replace(/[.\u2026]+$/, '');
  const card = cards.find((c) => c?.m && (!room || c.room === room)
    && (cardWords(c.m.text).includes(words) || cardWords(c.m.title).includes(words))) || null;
  return { room, card };
}

// briefingRooms — the rooms a briefing's items name (`(חדר <room>`), so the console can read their pending cards.
export function briefingRooms(b) {
  const rooms = new Set();
  for (const s of b?.sections || []) for (const it of s.items) { const { room } = briefingItemCard(it); if (room) rooms.add(room); }
  return [...rooms];
}

// The sidebar splits into two cards (Oren, 21 Oct 2026, option ג): the rooms that run Cleopatra on top, the clients and
// their builders below. A room is the company's when it is listed here or its doc says group:'company'; everything
// else is a client's, so a new client room lands in the right card without anyone tagging it.
export const COMPANY_ROOMS = new Set(['hq2', 'hq', 'strategy', 'coo', 'cfo', 'decisions', 'god-lab']);
// The dashboard is a room (Oren, 21 Oct 2026: "put the dashboard as just another room instead of a whole new screen"). It
// has no Firestore room doc and no messages: the console lists it pinned on top of the company card, and opening it
// shows the dashboard's cards (dashboard.html, embedded) where a room's thread would be. The cards' own doc stays
// elad-oren-config/dashboard (ADR-2610200607dr).
export const DASHBOARD_ROOM = 'dashboard';
export const DASHBOARD_ROOM_DATA = Object.freeze({ name: 'Dashboard', clientName: 'Dashboard', group: 'company', pinned: true, icon: '📊' });
// withDashboardRoom — the room docs plus the dashboard's, first and once, shaped like a Firestore doc ({ id, data() }).
export function withDashboardRoom(docs = []) {
  const rest = docs.filter((d) => d.id !== DASHBOARD_ROOM);
  return [{ id: DASHBOARD_ROOM, data: () => DASHBOARD_ROOM_DATA }, ...rest];
}
// The head of the sidebar is fixed (Oren, 23 Oct 2026: "the dashboard room always on top, then Boss, then all the rest,
// because that is the hierarchy between them"): these rooms lead in this order, above every pinned or recent room.
export const HEAD_ROOMS = Object.freeze([DASHBOARD_ROOM, 'hq2']);
// roomHeadRank — a room's place in the fixed head (0, 1, …), or HEAD_ROOMS.length for every other room.
export function roomHeadRank(id) {
  const i = HEAD_ROOMS.indexOf(id);
  return i < 0 ? HEAD_ROOMS.length : i;
}
// shownParent — the room a sidebar row nests under: its `parentRoom` when that room is in the list, else null (the row
// stands at the top level). A build room whose parent was renamed (feldman-book → oren-feldman-book-generator) or
// archived otherwise vanished from the sidebar (Oren, 27 Oct 2026: "I cannot see a builder room for this client"). PURE.
export function shownParent(parentRoom, liveIds) {
  return typeof parentRoom === 'string' && parentRoom && liveIds.has(parentRoom) ? parentRoom : null;
}
export function roomSection(id, r = {}) {
  if (String(r.group || '').toLowerCase() === 'company') return 'company';
  return COMPANY_ROOMS.has(id) ? 'company' : 'clients';
}

// ── Client identity (ADR-2610231318sv step 5; Oren, 24 Oct 2026, option C: "each client has one fixed emoji and one
// fixed colour, shared by all its rooms") ──────────────────────────────────────────────────────────────────────────
// A client's rooms — its own room, its build room, an "earlier work" room — show one emoji and one colour: on the room
// list's swatch and on every chip into any of them. The room doc says it with `emoji` (+ `color`); a room with no
// `emoji` takes this table; a build room has neither and inherits through `parentRoom`. A room doc's `color` ALONE is
// not an identity: many rooms carry an old filter-palette colour (#5b9bd5 on a dozen of them), so only `emoji` opts a
// doc in. The company's rooms (roomSection 'company') never carry one: they keep today's look. Colours read ≥ 3:1 on
// both themes' backgrounds. No two clients share an emoji, and no client shares one with a company room's icon or the
// pool an unknown room draws from (ROOM_ICONS, ROOM_ICON_POOL below): with ~24 clients the emoji is what tells them
// apart; the colour supports it (distinct, hues spread ≥ 10° apart, which on a small swatch is a hint, not a name).
// Follow-up (Oren, 24 Oct 2026, "Go"): Lazarus left Boss's 🌸 for ⚖️ (the decisions room took 🗳️), Catchy left TABS's
// 🧭 for 🎣, CFO left 🧭 for 💰, and every client room of the console's CLIENTS & BUILDERS section got a line.
// Keys are room ids (an alias room maps to the same object) or a room doc's `client` value.
const id_ = (emoji, color) => Object.freeze({ emoji, color });
const CLIENT_BRICKWISE = id_('🧱', '#b3361f');
const CLIENT_BOOK = id_('🌿', '#b7791f');     // the AI Personalized Book
const CLIENT_GSA = id_('🍀', '#2563eb');
const CLIENT_LAZARUS = id_('⚖️', '#be185d');
const CLIENT_JUSTIN = id_('👟', '#7c3aed');
const CLIENT_AIRTREE = id_('🪁', '#1572be');
const CLIENT_TSHIRTS = id_('👕', '#db1839');
const CLIENT_SHALHEVET = id_('🔥', '#b85014');
export const CLIENT_IDENTITY = Object.freeze({
  brickwise: CLIENT_BRICKWISE, brickwise2: CLIENT_BRICKWISE,
  tabs: id_('🧭', '#0e7490'),
  'oren-feldman-book-generator': CLIENT_BOOK, 'feldman-book': CLIENT_BOOK,
  gsa: CLIENT_GSA, 'gsa-planning': CLIENT_GSA,
  justin: CLIENT_JUSTIN, jd: CLIENT_JUSTIN,
  'client-2': id_('🦁', '#15803d'),                                            // Monaco Solicitors
  'client-3': CLIENT_LAZARUS, 'lazarus-legal2': CLIENT_LAZARUS,               // Lazarus Legal
  settld: id_('🐬', '#4d7c0f'),
  acta: id_('🧾', '#5c5ced'),
  airtree: CLIENT_AIRTREE, 'sid-airtree': CLIENT_AIRTREE,
  alon: id_('🌳', '#1a810e'),
  catchy: id_('🎣', '#0e7d74'),
  'future-classics': id_('🎻', '#60790d'),
  'kicks-bricks': id_('⚽', '#0e821e'),
  client: CLIENT_TSHIRTS, 'cleo-tshirts': CLIENT_TSHIRTS, 'creating-shirts': CLIENT_TSHIRTS, // Cleo T-Shirts
  shalhevet: CLIENT_SHALHEVET, 'sharon-medical': CLIENT_SHALHEVET, 'shalhevet-zoller': CLIENT_SHALHEVET,
  chen: id_('🦋', '#a530e8'),                                                  // Chen Gabay (chen-build's parent)
  'yael-kario': id_('🧠', '#c616b5'),                                          // Yael Kario CBT (yael-kario-build's parent)
  glassons: id_('🛍️', '#cf1791'),
  yaeli: id_('🐐', '#72740d'),
  menahs: id_('🐝', '#856d0f'),
  shai: id_('🎁', '#bb18d4'),
  'zanza-tours': id_('🗺️', '#0e7f55'),
  'seren-capital': id_('📈', '#347f0e'),
});
// The icon a room shows when it has no client identity: a room doc's own `icon`, else ROOM_ICONS, else a stable glyph
// from ROOM_ICON_POOL by its id's hash. Client rooms are not listed here (CLIENT_IDENTITY names them); the company's
// rooms are pinned so none ever draws a client's glyph (tests/unit/console-client-identity.spec.mjs).
export const ROOM_ICONS = Object.freeze({
  hq: '🏛', hq2: '🌸', decisions: '🗳️', strategy: '🎯', cfo: '💰', coo: '🌸', 'god-lab': '🐦',
  heritage: '🏰', 'legal-bs': '📜', 'business-visit-card': '💳', 'elad-and-oren-chat': '💬',
});
export const ROOM_ICON_POOL = Object.freeze(['🚀', '🌟', '🔷', '🪐', '🧩', '🎨', '🔮', '⚓', '🛰', '🌀', '🔶', '🌊', '🏔', '🦊', '🪸', '🎐', '🏵', '🎈']);
export function roomIcon(id, data) {
  if (data?.icon) return String(data.icon);
  if (Object.hasOwn(ROOM_ICONS, id)) return ROOM_ICONS[id];
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ROOM_ICON_POOL[h % ROOM_ICON_POOL.length];
}
// roomSwatchInner — what goes inside a room's swatch: its photo (avatarMarkup), else its client's emoji, else its icon.
// The glyph is text from a room doc, so it is escaped here (`esc`, the console's escaper). PURE.
export function roomSwatchInner(id, data, cl = null, esc = escTree) {
  return avatarMarkup(data || {}, { monogram: esc(cl?.emoji || roomIcon(id, data || {})), cls: 'swatch-img', esc, alt: '' });
}
const IDENTITY_COLOR_RX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i; // a hex colour only: the value lands in a style attribute
const CLIENT_HOPS_MAX = 4; // a build room's parent is a client's room: a chain longer than this is a loop or a mistake
// identityOf — a room doc's own { emoji, color } when it carries an emoji (≤ 8 code units, a glyph, not a sentence),
// else null; a colour that is not a hex colour reads as none.
function identityOf(r, fallbackColor = null) {
  const emoji = typeof r?.emoji === 'string' ? r.emoji.trim() : '';
  if (!emoji || emoji.length > 8) return null;
  const color = IDENTITY_COLOR_RX.test(String(r.color || '')) ? r.color : fallbackColor;
  return { emoji, color };
}
// clientIdentity — room `id`'s client { emoji, color }, or null (a company room, a room of no known client). `roomOf(id)`
// → that room's doc data (or null/{} when unknown). Walks `parentRoom` up, at most CLIENT_HOPS_MAX rooms, never twice.
// PURE.
export function clientIdentity(id, roomOf = () => null, { table = CLIENT_IDENTITY } = {}) {
  const seen = new Set();
  let cur = id;
  for (let hop = 0; cur && hop <= CLIENT_HOPS_MAX && !seen.has(cur); hop++) {
    seen.add(cur);
    const r = roomOf(cur) || {};
    if (roomSection(cur, r) === 'company') return null;
    const own = Object.hasOwn(table, cur) ? table[cur] : (r.client && Object.hasOwn(table, r.client) ? table[r.client] : null);
    const fromDoc = identityOf(r, own?.color || null);
    if (fromDoc) return fromDoc;
    if (own) return { emoji: own.emoji, color: own.color };
    cur = typeof r.parentRoom === 'string' ? r.parentRoom : null;
  }
  return null;
}

// ── The thread tree on the screen (ADR-2610231318sv step 4; Oren, 24 Oct 2026, after the thread-hierarchy simulator:
// "I don't want a screen that overloads me") ──────────────────────────────────────────────────────────────────────
// A thread root may carry `parent: "<room>/<rootId>"` (the thread that opened it) and `children: [refs]` (the threads it
// opened) — DATA-MODEL §2h‴. The console shows them quietly: a line of chips under a parent's head, a dot per child on
// its row, "↳ <parent>" and "Replies go through <parent>" in a child, an O/E initial on a thread a director opened, and
// every `{{room/id}}` in a message as a chip. These mirror kernel2/thread-tree-logic.mjs (parseThreadRef, parentOf,
// childRefs); tests/unit/console-thread-tree.spec.mjs pins that they read the same docs the same way. PURE.
const TREE_REF_RX = /^([a-z0-9][a-z0-9-]*)\/([A-Za-z0-9_-]+)$/;
export const TREE_CHILDREN_MAX = 20; // the kernel's MAX_CHILDREN_READ: a parent owns a handful
// parseTreeRef — "<room>/<rootId>" → { room, id }, or null.
export function parseTreeRef(ref) {
  const m = String(ref || '').match(TREE_REF_RX);
  return m ? { room: m[1], id: m[2] } : null;
}
// treeParent — the thread that opened this one, or null for an origin. An escalation written before the field names its
// asking thread in fromRoom/fromThreadId (the kernel's tolerant reader).
export function treeParent(doc) {
  if (!doc) return null;
  if (parseTreeRef(doc.parent)) return String(doc.parent);
  if (doc.kind === 'boss-handoff' && doc.why === 'escalation' && doc.fromRoom && doc.fromThreadId) {
    const r = `${doc.fromRoom}/${doc.fromThreadId}`;
    return parseTreeRef(r) ? r : null;
  }
  return null;
}
// treeChildren — the parent's index of its children: valid, unique, at most TREE_CHILDREN_MAX.
export function treeChildren(doc) {
  const list = Array.isArray(doc?.children) ? doc.children : [];
  return [...new Set(list.map(String).filter((r) => parseTreeRef(r)))].slice(0, TREE_CHILDREN_MAX);
}
// GOAL_STATUS — a goal's state as the console's status word (the same map taskStatus reads a goal room's root with): a
// question needs you, a `waiting` goal is parked on something outside ("Waiting on"), done and dropped are finished.
export const GOAL_STATUS = Object.freeze(Object.assign(Object.create(null), { working: 'working', question: 'waiting', waiting: 'on-hold', done: 'done', dropped: 'done' })); // no prototype: a state like 'toString' reads as unknown
// refStatus — one status word for a thread seen only by its root doc (a chip): its goal, else a hand-off Boss closed
// (`closedAt`), else the root's turn. `undefined` = not read yet → 'pending'; null = deleted → 'done'.
export function refStatus(doc) {
  if (doc === undefined) return 'pending';
  if (doc === null) return 'done';
  const g = GOAL_STATUS[doc.goal?.state];
  if (g) return g;
  if (doc.closedAt) return 'done';
  if (doc.errored) return 'stuck';
  if (doc.turnState === 'working' || doc.turnState === 'waiting') return 'working';
  if (doc.turnState === 'done') return 'done';
  return 'pending';
}
// originBadge — the small round initial on a thread a director opened (no parent): { initial, who, color } in the
// avatar's own colours (authorColor), or null.
export const ORIGIN_DIRECTORS = Object.freeze(['Oren', 'Elad']);
export function originBadge(doc) {
  if (!doc || treeParent(doc) || !ORIGIN_DIRECTORS.includes(doc.from)) return null;
  return { initial: authorInitial(doc.from), who: doc.from, color: authorColor(doc.from) };
}
// threadChip — what a chip into thread `ref` shows: { ref, href, title, status, faded, room, roomName, identity }.
// `doc` undefined = still being read (title '…'), null = deleted (the room's name). `fadeDone` fades a finished thread
// (a parent's line of children); a parent or a `{{ref}}` chip is never faded. `identity` is the hook for step 5 (a
// client's { emoji, color }); null today.
export function threadChip(ref, doc, { names = null, roomName = '', identity = null, fadeDone = false, mid = '' } = {}) {
  const p = parseTreeRef(ref);
  if (!p) return null;
  const status = refStatus(doc);
  const title = doc === undefined ? '…' : doc === null ? `#${roomName || p.room}`
    : (threadTitle({ id: p.id, m: doc }, [], names) || `#${roomName || p.room}`);
  return { ref: `${p.room}/${p.id}`, href: `#${p.room}/${p.id}${mid ? `/${mid}` : ''}`, ...(mid ? { mid } : {}), title, status, faded: fadeDone && status === 'done', room: p.room,
    roomName: roomName || p.room, identity: identity && identity.emoji ? identity : null };
}
const escTree = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// threadChipHtml — the chip: a state dot (the row's own dot colours, `.tdot.<status>`) and the title, a link to the
// thread. Escaped here; the caller adds nothing but where it goes. The tint (`tchip-cl`) needs a colour to tint with: an
// identity with an emoji and no colour shows the emoji on a plain chip, as the room list shows it on a plain row.
export function threadChipHtml(chip) {
  if (!chip) return '';
  const id = chip.identity;
  return `<a class="tchip${chip.faded ? ' faded' : ''}${id?.color ? ' tchip-cl' : ''}" href="${escTree(chip.href)}"`
    + ` data-ref="${escTree(chip.ref)}" title="${escTree(chip.roomName)} · ${escTree(STATUS_LABELS[chip.status] || chip.status)}"`
    + `${id?.color ? ` style="--cl:${escTree(id.color)}"` : ''}>`
    + `${id ? `<span class="tchip-em">${escTree(id.emoji)}</span>` : ''}`
    + `<span class="tdot ${escTree(chip.status)}"></span><span class="tchip-t" dir="auto">${escTree(chip.title)}</span></a>`;
}
// threadCardHtml — a link to a thread on a line of its own, as a card (Oren, 26 Oct 2026: "can links to threads look
// nicer?"; Fable's design): the state dot, the title on line 1, "room · when · a marked message" on line 2, an arrow at
// the end edge. One `<a>`, so the whole card is the tap target; `when` is threadTimes' text, already formatted. Its
// direction is the title's first strong letter, set outright (not dir="auto"), so the arrow can point to the end edge.
const FIRST_STRONG_RTL = /^[^A-Za-z\u00C0-\u024F\u0590-\u08FF]*[\u0590-\u08FF]/;
export function threadCardHtml(chip, when = '') {
  if (!chip) return '';
  const id = chip.identity;
  const rtl = FIRST_STRONG_RTL.test(chip.title);
  const meta = [`${id ? `${id.emoji} ` : ''}${chip.roomName}`, when, chip.mid ? 'הודעה מסומנת' : ''].filter(Boolean).join(' · ');
  return `<a class="tcard${chip.faded ? ' faded' : ''}${id?.color ? ' tcard-cl' : ''}" href="${escTree(chip.href)}" dir="${rtl ? 'rtl' : 'ltr'}"`
    + ` data-ref="${escTree(chip.ref)}" title="${escTree(chip.roomName)} · ${escTree(STATUS_LABELS[chip.status] || chip.status)}"`
    + `${id?.color ? ` style="--cl:${escTree(id.color)}"` : ''}>`
    + `<span class="tdot ${escTree(chip.status)}"></span><span class="tcard-b"><span class="tcard-t" dir="auto">${escTree(chip.title)}</span>`
    + `<span class="tcard-m" dir="auto">${escTree(meta)}</span></span><span class="tcard-go" aria-hidden="true">${rtl ? '‹' : '›'}</span></a>`;
}
// threadLinkRef — a URL that opens a thread in this console (`…/elad-and-oren/[index.html]#room/id[/mid]`, on
// cleo2.pages.dev or on the page it is read on, `here`) → "room/id" or "room/id#mid"; anything else → null. Cleo writes
// these full URLs to point a director at a thread; the formatter shows them as a chip or a card, never as the URL.
const CONSOLE_HOST = /(^|\.)cleo2\.pages\.dev$/;
const THREAD_HASH = /^#([a-z0-9][a-z0-9-]*\/[A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?$/;
export function threadLinkRef(url, here = '') {
  let u, h = null;
  try { u = new URL(url); } catch { return null; }
  try { h = here ? new URL(here) : null; } catch { h = null; }
  const page = (p) => p.replace(/\/index\.html$/, '/');
  const ours = (CONSOLE_HOST.test(u.hostname) && u.protocol === 'https:' && page(u.pathname) === '/elad-and-oren/')
    || (h && u.origin === h.origin && page(u.pathname) === page(h.pathname));
  if (!ours || u.search) return null;
  const m = u.hash.match(THREAD_HASH);
  return m ? (m[2] ? `${m[1]}#${m[2]}` : m[1]) : null;
}
// threadLinksToTokens — plain text with every thread URL (threadLinkRef) turned into its `{{room/id[#mid]}}`, a trailing
// full stop or bracket kept outside; a one-line preview then reads the thread's title (threadTokenTitles), not the URL.
export function threadLinksToTokens(text = '', here = '') {
  return String(text ?? '').replace(/https?:\/\/[^\s<>`]+/gi, (url) => {
    const [, bare, tail] = url.match(/^(.*?)([.,;:!?)]*)$/);
    const tl = threadLinkRef(bare, here);
    return tl ? `{{${tl}}}${tail}` : url;
  });
}
// splitThreadLink — "room/id[#mid]" → { ref: "room/id", mid } (mid '' when the link names the thread alone).
export function splitThreadLink(link = '') {
  const [ref, mid = ''] = String(link ?? '').split('#');
  return { ref, mid };
}
// THREAD_TOKEN — `{{room/id}}` in message text, also after the formatter isolated it as a Latin run (`<bdi>…</bdi>`).
// `{{room/id#mid}}` is the formatter's own form for a link to one message in the thread (threadLinkRef).
const THREAD_TOKEN = /\{\{(?:<bdi>)?([a-z0-9][a-z0-9-]*\/[A-Za-z0-9_-]+(?:#[A-Za-z0-9_-]+)?)(?:<\/bdi>)?\}\}/g;
// threadTokenRefs — the threads a text names ("room/id"), once each, in order.
export function threadTokenRefs(text = '') {
  return [...new Set([...String(text ?? '').matchAll(THREAD_TOKEN)].map((m) => splitThreadLink(m[1]).ref))];
}
// expandThreadTokens — formatted message HTML with every `{{room/id}}` replaced by `chipHtmlFor(ref)`.
export function expandThreadTokens(html = '', chipHtmlFor = () => '') {
  return String(html ?? '').replace(THREAD_TOKEN, (_, ref) => chipHtmlFor(ref) || `{{${ref}}}`);
}
// threadTokenTitles — plain text (a row's one-line preview) with every `{{room/id}}` replaced by that thread's title.
export function threadTokenTitles(text = '', titleFor = () => '') {
  return String(text ?? '').replace(THREAD_TOKEN, (_, link) => { const { ref } = splitThreadLink(link); return titleFor(ref) || ref; });
}

// ── The directors' quick call (Oren, 26 Oct 2026, ADR-2610260538yg): 📞 opens the one fixed Meet link and rings the
// other director. The Mac rings his devices and sends the notes bot (adapters/meet/quick-call-logic.mjs); these are the
// console's half.

// QUICK_CALL_RING_SEC — how long an incoming call rings in an open console tab before it gives up by itself. Also the
// freshness window for showing it at all: a ring older than this when the tab first sees it is a call already over.
export const QUICK_CALL_RING_SEC = 45;

// quickCallLink — the configured Meet link (elad-oren-config/app.quickCallUrl), canonical; anything else → null. The
// same test as adapters/meet/extension/shared.js parseMeetUrl, so the console never opens a non-Meet address.
export function quickCallLink(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'meet.google.com' || u.port) return null;
  const m = u.pathname.replace(/^\/+|\/+$/g, '').toLowerCase().match(/^(?:(?:meet|_meet)\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})$/);
  return m ? `https://meet.google.com/${m[1]}` : null;
}

// quickCallPeer — whom 📞 calls: the one other director. None (or more than one other) → null, and the button hides.
export function quickCallPeer(directorNames = [], me = '') {
  const others = [...new Set(directorNames)].filter((n) => n && n !== me);
  return others.length === 1 ? others[0] : null;
}

// quickCallRing — the ring the caller writes onto the callee's push doc (`setDoc(…, { mergeFields: ['ring'] })`, so an
// earlier call's result fields are replaced, not merged in). `at` is the server timestamp the caller passes in.
export function quickCallRing({ id, from, at } = {}) {
  return { ring: { id: String(id), from: String(from), at } };
}

// incomingRing — should this tab ring now for the ring on MY push doc? Only a fresh call from another director that
// this tab has not rung already. `at` arrives as a Firestore Timestamp (or null while it is still pending).
export function incomingRing({ ring = null, me = '', nowMs = 0, seen = new Set(), ringSec = QUICK_CALL_RING_SEC } = {}) {
  if (!ring || !ring.id || !ring.from || ring.from === me || seen.has(ring.id)) return false;
  const at = ring.at == null ? NaN : typeof ring.at.toMillis === 'function' ? ring.at.toMillis() : Number(ring.at);
  if (!Number.isFinite(at)) return false;
  return nowMs - at < ringSec * 1000;
}

// ringOutcome — what the caller's tab says once the Mac has handled the ring (`pushedAt` set), or null while it has not.
export function ringOutcome(ring = null, id = '', peer = '') {
  if (!ring || ring.id !== id || ring.pushedAt == null) return null;
  if (ring.sent > 0) return { ok: true, line: `📞 ${peer}'s phone is ringing (${ring.sent} device${ring.sent === 1 ? '' : 's'}). Cleo joins the call.` };
  return { ok: false, line: `📞 ${peer}'s phone did not ring: ${ring.error || 'no device took the push'}. The call is open; send him the link.` };
}

// ── The safe-mode strip (Oren, 27 Oct 2026: "a clear, not hidden indication when we switch to SAFE MODE, and one tap to
// ask whether it is safe to turn off"). The tripwire sets elad-oren-config/control.safeMode when a core file changes
// off-gate; while it is on, rooms run one at a time and cannot hand work to each other. safeModeStrip(control) is what
// the console draws from that doc: null (no strip) unless safeMode is exactly true, else the strip's words and the
// one message its button posts as a new thread in Boss (SAFE_MODE_ASK_ROOM) through the composer's own sendMsg.
export const SAFE_MODE_ASK_ROOM = UI_REQUEST_ROOM;
export const SAFE_MODE_ASK_TEXT = 'מצב הבטיחות דלוק. תבדקי מה הדליק אותו ואם בטוח לכבות ולחזור לעבודה רגילה.';
export function safeModeStrip(control = null) {
  if (!control || control.safeMode !== true) return null;
  return {
    title: 'מצב בטיחות דלוק',
    line: 'החדרים עובדים אחד-אחד ולא יכולים להעביר עבודה זה לזה.',
    button: 'לבדוק אם אפשר לכבות',
    sending: 'שולח לבוס…',
    sent: 'נשלח לבוס',
    failed: 'לא נשלח — נסו שוב',
    room: SAFE_MODE_ASK_ROOM,
    message: SAFE_MODE_ASK_TEXT,
  };
}

// parseKeyCommand — "/key NAME=value [@target]", the secure key drop, from ANY composer (the bottom one and a thread's
// reply box: 27 Oct 2026, a key typed in a thread reply went out as a plain message and showed in the chat).
// null = not a /key line; { ok:false } = a /key line that is malformed (never sent as text); else the drop. PURE.
export function parseKeyCommand(text = '') {
  const t = String(text || '').trim();
  if (!/^\/key\b/i.test(t)) return null;
  const body = t.replace(/^\/key\s*/i, '').trim();
  const at = body.match(/\s@([a-z0-9._-]+)\s*$/i);
  let target = 'eo-secrets', rest = body;
  if (at) { target = at[1]; rest = body.slice(0, at.index).trim(); }
  const eq = rest.indexOf('=');
  const name = eq > 0 ? rest.slice(0, eq).trim() : '';
  const value = eq > 0 ? rest.slice(eq + 1).trim() : '';
  if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !value) return { ok: false };
  return { ok: true, name, value, target };
}

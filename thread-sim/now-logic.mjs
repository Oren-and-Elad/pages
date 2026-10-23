// now-logic.mjs — the PURE brain of the Cleo 2.1 front door (now.html / now.js). No DOM, no Firestore, no clock
// of its own (every function takes `now`), so tests/unit/now-logic.spec.mjs pins it offline.
//
// What it decides:
//   • seatName / seatKind   — the director-friendly names for rooms (Cleo, Chief of Staff, Finance, Workshop…)
//   • collectNeedsYou       — every undecided card across ALL rooms, ranked (a client send first, then money,
//                             then a ship, then everything else; oldest first inside a rank) — the "Needs you"
//                             layer that sits on every screen so a card can never be lost in a room you are not in
//   • pickNow               — the ONE thing the Now screen shows (a card, else a stuck/working seat, else quiet)
//   • todayFeed             — what happened today, newest first, one line per event
//   • seatState             — a room's live state from the relay's `room.turn` mirror (same rules as the
//                             console's roomIndicator, restated here so the two never drift silently)
//   • quietLine / presenceLine / fmtAge / snippet / detectLang — small text helpers
//   • boardFreshness / shouldHealBoard — how old the board on screen is, whose fault that is, and whether the page
//                             may re-open its board listener now (ADR-0266)
//
// Owning phase: console (Cleo 2.1 stage 1 — "split and see"; non-core, ships on tests green).

// ── seats ────────────────────────────────────────────────────────────────────────────────────────────
// Company seats get people-names; a client room is its client; a `-build` child is its parent's Workshop.
export const SEAT_NAMES = Object.freeze({
  hq: 'Cleo', coo: 'Chief of Staff', strategy: 'Strategy', cfo: 'Finance', build: 'Workshop',
  'coo-build': "Cleo's Workshop", decisions: 'Decisions', meta: 'Meta',
  // the two rooms that were never named (7 Sep, Oren: "are these the right room names?") — the client each one holds
  client: 'Cleo T-shirts', 'client-2': 'Monaco Solicitors', 'gsa-planning': 'GSA Planning · earlier work',
  'kicks-bricks': 'Kicks & Bricks', 'kicks-and-bricks': 'Kicks & Bricks',
});
// RETIRED_ROOMS — rooms that outlived their use and are not archived in the store (the phone app cannot archive):
// the old GSA room (last message 18 Aug, superseded by `gsa`) and #shai (June, no client). Hidden here like an
// archived room; they still exist and still wake if a live turn or an open card lands in them.
export const RETIRED_ROOMS = Object.freeze(new Set(['gsa-planning', 'shai']));
const WORKSHOP_SUFFIX = /-build$/;

export function seatName(roomId, room = {}) {
  const id = String(roomId || '');
  if (SEAT_NAMES[id]) return SEAT_NAMES[id];
  if (WORKSHOP_SUFFIX.test(id)) return `${seatName(id.replace(WORKSHOP_SUFFIX, ''), {})} · Workshop`;
  if (room?.clientName) return String(room.clientName);
  const bare = String(room?.name || id).replace(/^#/, '');
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : id;
}

// seatKind — 'cleo' (the general seat), 'seat' (a company seat), 'workshop' (a build lane), 'decisions', or 'client'.
export function seatKind(roomId, room = {}) {
  const id = String(roomId || '');
  if (id === 'hq') return 'cleo';
  if (id === 'decisions') return 'decisions';
  if (WORKSHOP_SUFFIX.test(id) || id === 'build') return 'workshop';
  if (['coo', 'strategy', 'cfo', 'meta'].includes(id)) return 'seat';
  return 'client';
}

// ── time / text helpers ──────────────────────────────────────────────────────────────────────────────
export const tsMs = (v) => {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
};

export function fmtAge(ms) {
  // FLOOR, not round. An age is "how long since", and rounding it up overstates staleness in every
  // bucket: 30 seconds read as "1 min", 90 minutes as "2 h", 47 hours as "2 d". On this screen that
  // lands on the two lines a director actually reads — "was here 2 h ago" for someone who was here
  // ninety minutes ago, and a last-activity line that makes a live seat look abandoned. Flooring is
  // also how every clock a person already trusts behaves: 1:59 is "1 hour", not "2 hours".
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

// snippet — a card/message body as one plain line: markdown bold/italic/links stripped, whitespace folded.
export function snippet(text, max = 160) {
  let s = String(text ?? '');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/^#+\s*/gm, '').replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// detectLang — 'he' when the text carries Hebrew letters, else 'en'. Drives dir="auto" fallbacks + the mic default.
export function detectLang(text) {
  return /[֐-׿]/.test(String(text || '')) ? 'he' : 'en';
}

// (dirFor lived here; it read a block's direction from its first letter, which is the bug ADR-0212 fixes.
// Every surface now uses textDir from logic.js.)

// ── cards ────────────────────────────────────────────────────────────────────────────────────────────
// retiredOrConsumed (ADR-0173, carried to the console by ADR-0194) — `status` is not the whole truth about a card.
// The stale-park sweep deliberately leaves `status: 'pending'` (the gate reads that field as a decision, so
// overwriting it would route a dead card to a spurious re-entry) and marks the card dead in its own fields
// instead; a card whose tap has already been acted on is `consumed`. Both stay pending for ever, and the kernel's
// own reader (kernel/open-cards.mjs) stopped counting them a while ago — the Now screen did not, so its
// "N need you" pill counted dead parks as live asks. A retired or consumed card is waiting on nobody.
const retiredOrConsumed = (m = {}) => m.retired === true || m.consumed === true;

// PENDING (restated from logic.js so this module has no import): an undecided question / approval / align card.
export const isPendingCard = (m = {}) =>
  !retiredOrConsumed(m) && (
  ((m.type === 'question' || m.type === 'approval' || m.type === 'align') && (!m.status || m.status === 'pending'))
  // a HELD build (the plan gate exhausted its rounds) is a director's word, not a button — it must still be on
  // the Now screen (6 Sep 16:21Z: the nightly review's security fix sat held for hours, invisible here)
  || (m.type === 'qa-plan-escalation' && m.needsYou === true && !m.status)
  // the kernel's core sign-off notice: a self change on a protected path, committed, waiting on a director.
  // P2.5 (ADR-0043): the old kind now lives in `subkind` (family = stop-switch); accept either for back-compat.
  || ((m.subkind || m.kind) === 'selfmod-core' && m.needsYou === true && !m.status)
  // ADR-0241: a live ALERT — something only a person can fix (WhatsApp unlinked). It has no buttons and is not an
  // answer to anything; it waits here until the kernel stamps it `status: 'cleared'` because the thing is fixed.
  || isOpenAlert(m));

// isOpenAlert — an alert doc that still needs a person (ADR-0241). The kernel clears it; nobody taps it.
export const isOpenAlert = (m = {}) => m.type === 'alert' && m.needsYou === true && !m.status;

// A decision card is pending for ME until I have answered it (each director answers; consensus/conflict closes it).
export const isPendingDecision = (m = {}, me = '') =>
  !retiredOrConsumed(m)
  && m.type === 'decision' && !['consensus', 'conflict', 'resolved'].includes(m.status || 'pending') && !(m.answers && m.answers[me]);

// cardLabel — what kind of tap this is, in the founders' words. rank orders the Needs-you list (lower first).
export function cardLabel(m = {}) {
  // P2.5 (ADR-0043): the OLD kind vocabulary now lives in `subkind` under a family kind; a legacy card has no
  // subkind, so `subkind || kind` reads the right label token either way.
  const kind = String(m.subkind || m.kind || '').toLowerCase();
  const text = String(m.text || m.title || '').toLowerCase();
  if (m.type === 'alert') return { label: 'Needs a person', tone: 'alert', rank: 0 }; // ADR-0241: first — nothing else works until it is fixed
  if (m.type === 'decision') return { label: 'Each of you', tone: 'decision', rank: 3 };
  if (m.type === 'qa-plan-escalation') return { label: 'A build is held — your word', tone: 'ask', rank: 2 };
  if (kind === 'selfmod-core') return { label: 'A core change — your sign-off', tone: 'ship', rank: 2 };
  if (m.type === 'approval') {
    if (/email|whatsapp|send|reply/.test(kind)) return { label: 'Send to client', tone: 'send', rank: 0 };
    if (/calendar|meeting|invite/.test(kind)) return { label: 'Meeting invite', tone: 'send', rank: 0 };
    if (/deploy|ship|prod|publish|merge/.test(kind)) return { label: 'Ship to production', tone: 'ship', rank: 2 };
    if (/spend|money|invoice|pay/.test(kind)) return { label: 'Money', tone: 'money', rank: 1 };
    return { label: 'Approve', tone: 'ship', rank: 2 };
  }
  if (kind === 'spend-alert' || /spend heads-up|daily .*cap/.test(text)) return { label: 'Money', tone: 'money', rank: 1 };
  if (kind === 'prod-ship') return { label: 'Ship to production', tone: 'ship', rank: 2 };
  if (m.type === 'align') return { label: 'Align', tone: 'ask', rank: 3 };
  return { label: 'Your call', tone: 'ask', rank: 3 };
}

// ── card families (P2.5/ADR-0043, rendered in P4b) ─────────────────────────────────────────────────────────────
// The kernel writes a family as `m.kind` (one of these three) and keeps the OLD vocabulary in `m.subkind`. A
// LEGACY card has an old kind and no family — so read `m.kind` when it is already a family, else map the old
// kind/subkind, else the safe default `needs-input` (ask a human). Self-contained — mirrors card-families-logic's
// SUBKIND_FAMILY so this module keeps its no-import rule.
export const CARD_FAMILIES = ['needs-input', 'stop-switch', 'hold'];
const SUBKIND_FAMILY = {
  'selfmod-core': 'stop-switch', 'stop-switch': 'stop-switch', 'leave-declare': 'stop-switch',
  'prod-ship': 'hold', 'fable-hold': 'hold', 'auto-rollback': 'hold',
};
// cardFamily — the family a card belongs to (the reading/answering taxonomy). Pure.
export function cardFamily(m = {}) {
  const kind = String(m.kind || '');
  if (CARD_FAMILIES.includes(kind)) return kind;
  const sub = String(m.subkind || m.kind || '');
  return SUBKIND_FAMILY[sub] || 'needs-input';
}
// familyBadge — the short human label shown per card. Pure.
export function familyBadge(family) {
  return family === 'stop-switch' ? 'Your sign-off, with Fable'
    : family === 'hold' ? 'Held for you'
    : 'Needs your input';
}
// shadowVerdictLine — a one-line plain-words summary of a hold card's shadow Fable verdict, or '' when none. Pure.
export function shadowVerdictLine(m = {}) {
  const v = m.shadowVerdict || (m.meta && m.meta.shadowVerdict) || null;
  if (!v) return '';
  const verdict = String(v.verdict || '').trim();
  const why = String(v.holdReason || '').trim();
  const failed = Array.isArray(v.failed) && v.failed.length ? ` (${v.failed.slice(0, 4).join(', ')})` : '';
  if (!verdict && !why) return '';
  return `Fable’s shadow read: ${verdict || 'hold'}${why ? ` — ${why}` : ''}${failed}`;
}

// collectNeedsYou — every card waiting on a director, across every room, ranked. `messagesByRoom` is
// { roomId: [{ id, m }] } (any order). Returns [{ roomId, seat, id, m, label, tone, rank, ts, ageMs }].
// ADR-0239: a `quiet` card (a held task a director chose to keep) is live — its buttons work on its Tasks row — but
// it waits on nobody, so it is left out unless `withQuiet` (the Tasks screen, which shows it inline).
export function collectNeedsYou({ rooms = {}, messagesByRoom = {}, me = '', now = Date.now(), withQuiet = false } = {}) {
  const out = [];
  for (const [roomId, entries] of Object.entries(messagesByRoom)) {
    const room = rooms[roomId] || {};
    if (!roomVisible(room, roomId)) continue;
    const notMine = !!(me && room.owner && room.owner !== me);   // ADR-2610092304fx: an owned room's cards wait on its owner only
    for (const e of entries || []) {
      const m = e?.m || {};
      if (notMine && m.type !== 'alert' && m.veryUrgent !== true) continue; // …except a safety card, as on the push side
      const pending = isPendingCard(m) || isPendingDecision(m, me);
      if (!pending) continue;
      if (m.quiet === true && !withQuiet) continue;
      const ts = tsMs(m.createdAt);
      const { label, tone, rank } = cardLabel(m);
      out.push({ roomId, seat: seatName(roomId, room), id: e.id, m, label, tone, rank, ts, ageMs: ts ? Math.max(0, now - ts) : 0 });
    }
  }
  // rank first (a client send before a ship before a question), then OLDEST first — the thing that has waited
  // longest is the thing most likely to be hurting a client.
  out.sort((a, b) => (a.rank - b.rank) || (a.ts - b.ts) || a.id.localeCompare(b.id));
  return out;
}

// ── seats' live state ────────────────────────────────────────────────────────────────────────────────
// seatState — 'waiting' (on a director), 'paused' (usage limit, auto-resumes), 'working', 'stuck' (a real
// error, not retrying), 'queued', or 'idle'. Mirrors logic.js roomIndicator's precedence exactly.
export function seatState(room = {}) {
  const turn = room.turn || {};
  if (room.waitingOn) return 'waiting';
  if (turn.retrying) return 'paused';
  if (turn.turnState === 'working' || turn.turnState === 'waiting') return 'working';
  if (turn.turnState === 'done' && turn.errored && !turn.retrying) return 'stuck';
  if (turn.turnState === 'queued') return 'queued';
  return 'idle';
}

// roomVisible — an archived room stays hidden UNLESS the brain is still working in it or waiting on a director
// there. 3 Sep: the builder's deploy card sat in the archived `build` room for hours ("0 need you" while the
// release, and two builds queued behind it, waited). A room with a live turn or an open ask is live, whatever
// its flag says.
export function roomVisible(room = {}, roomId = '') {
  if (!room?.archived && !RETIRED_ROOMS.has(String(roomId || room?.id || ''))) return true;
  const st = room.turn?.turnState;
  return !!room.waitingOn || st === 'working' || st === 'queued' || st === 'waiting';
}

export const STATE_WORDS = Object.freeze({
  waiting: 'needs you', paused: 'paused — usage limit', working: 'working', stuck: 'stuck', queued: 'queued', idle: 'quiet',
});

// seatsOverview — every non-archived room as a seat row, company seats first, then clients (most recent first),
// workshops nested under their parent (parent id on `under`).
export function seatsOverview({ rooms = {}, now = Date.now() } = {}) {
  const rows = Object.entries(rooms)
    .filter(([id, r]) => roomVisible(r, id))
    .map(([id, r]) => ({
      id, name: seatName(id, r), kind: seatKind(id, r), state: seatState(r),
      lastMs: tsMs(r.lastMessageAt), under: WORKSHOP_SUFFIX.test(id) ? id.replace(WORKSHOP_SUFFIX, '') : (r.parentRoom || null),
      summary: snippet(r?.digest?.summary || '', 120),
    }));
  const order = { cleo: 0, seat: 1, decisions: 2, client: 3, workshop: 4 };
  rows.sort((a, b) => (order[a.kind] - order[b.kind]) || (b.lastMs - a.lastMs) || a.name.localeCompare(b.name));
  return rows.map((r) => ({ ...r, age: r.lastMs ? fmtAge(now - r.lastMs) : '' }));
}

// ── the one thing ────────────────────────────────────────────────────────────────────────────────────
// pickNow — what the Now screen leads with. A pending card beats everything; then a stuck seat (a real error
// nobody is retrying); then a seat that is working (so the founders can watch her); else quiet.
export function pickNow({ needsYou = [], rooms = {}, now = Date.now() } = {}) {
  if (needsYou.length) return { kind: 'card', item: needsYou[0], rest: needsYou.length - 1 };
  const seats = seatsOverview({ rooms, now });
  const stuck = seats.find((s) => s.state === 'stuck');
  if (stuck) return { kind: 'stuck', seat: stuck };
  const working = seats.filter((s) => s.state === 'working' || s.state === 'queued' || s.state === 'paused');
  if (working.length) return { kind: 'working', seats: working };
  return { kind: 'quiet' };
}

// ── today ────────────────────────────────────────────────────────────────────────────────────────────
// todayFeed — one line per event since `sinceMs` (default: 24 h), newest first, capped. Activity strips
// (kind 'activity') and relay/system noise are dropped; cards keep their label so the feed reads as a story.
export function todayFeed({ rooms = {}, messagesByRoom = {}, now = Date.now(), sinceMs = null, cap = 60 } = {}) {
  const since = sinceMs ?? (now - 24 * 3600 * 1000);
  const out = [];
  for (const [roomId, entries] of Object.entries(messagesByRoom)) {
    const room = rooms[roomId] || {};
    if (!roomVisible(room, roomId)) continue;
    for (const e of entries || []) {
      const m = e?.m || {};
      if (m.kind === 'activity') continue;
      const ts = tsMs(m.createdAt);
      if (!ts || ts < since) continue;
      const isCard = m.type === 'question' || m.type === 'approval' || m.type === 'decision' || m.type === 'align';
      const who = m.from === 'brain' || (!m.from && isCard) ? 'Cleo' : (m.from === 'system' || m.from === 'director' ? 'Cleo' : String(m.from || 'Cleo'));
      const text = snippet(m.text || m.body || m.title || '', 140);
      if (!text) continue;
      out.push({ roomId, seat: seatName(roomId, room), id: e.id, ts, who, text, card: isCard ? cardLabel(m).label : null, decided: isCard ? !!(m.status && m.status !== 'pending') : null });
    }
  }
  out.sort((a, b) => (b.ts - a.ts) || a.id.localeCompare(b.id));
  return out.slice(0, cap);
}

// lastEvent — the newest event anywhere (for the quiet line). null when nothing has happened.
export function lastEvent({ rooms = {}, messagesByRoom = {}, now = Date.now() } = {}) {
  return todayFeed({ rooms, messagesByRoom, now, sinceMs: 0, cap: 1 })[0] || null;
}

// quietLine — the sentence under "All quiet." Never a tech word.
export function quietLine({ last = null, now = Date.now() } = {}) {
  const base = 'Nothing needs you. Nobody is stuck.';
  if (!last) return `${base} It has been quiet all day.`;
  return `${base} The last thing that happened was in ${last.seat}: “${snippet(last.text, 90)}”, ${fmtAge(now - last.ts)} ago.`;
}

// presenceLine — where the OTHER director is, from elad-oren-config/presence ({ name: { room, updatedAt } }).
// A director seen in the last 3 minutes is "in <seat>"; otherwise "was here <age> ago"; unknown → null.
export function presenceLine({ presence = {}, me = '', rooms = {}, now = Date.now(), liveMs = 3 * 60 * 1000 } = {}) {
  const others = Object.entries(presence).filter(([name]) => name && name !== me);
  if (!others.length) return null;
  const [name, info] = others[0];
  const seen = tsMs(info?.updatedAt);
  if (!seen) return `${name} · not seen yet`;
  const where = info?.room ? seatName(String(info.room).replace(/^now:/, ''), rooms[info.room] || {}) : null;
  if (now - seen <= liveMs) return where ? `${name} · in ${where} now` : `${name} · here now`;
  return `${name} · was here ${fmtAge(now - seen)} ago`;
}

// decisionUpdate — the write for MY answer on a decision card (same algorithm as the console's answerDecision):
// answers.<me> = option; once each director has answered, status = consensus | conflict.
// P4b round-4: setting `status` makes this a decider write per firestore.rules' touchesDecider(), so it must carry
// the CALLER's OWN verified identity (decidedByUid/decidedByEmail == the authenticated caller) or deciderAuthentic()
// DENIES a legitimate director's answer. The caller (now.js) threads its own Firebase-Auth uid/email in — this
// module stays pure and auth-free. Stamp only on the status-setting write (the first, answers-only write trips
// neither touchesDecider nor a rule, so it needs no stamp); never a display name, never the other director's.
export function decisionUpdate({ m = {}, me = '', option = '', directors = [], uid = null, email = null } = {}) {
  const all = { ...(m.answers || {}), [me]: option };
  const updates = { [`answers.${me}`]: option };
  const need = Math.max(2, directors.length || 0);
  if (Object.keys(all).length >= need) {
    const vals = Object.values(all);
    updates.status = vals.every((v) => v === vals[0]) ? 'consensus' : 'conflict';
    if (uid || email) { updates.decidedByUid = uid; updates.decidedByEmail = email; }
  }
  return updates;
}

// ── work in progress ─────────────────────────────────────────────────────────────────────────────────
// activeWork — every build the company is running right now, as a row a director can watch (Oren, 3 Sep
// 19:40: "'sent for a fix' — but I can't SEE it's in progress. An update at most every 20 seconds, always
// visible, until it's done"). Source of truth per workshop room: the room doc's `buildHeartbeat` (step +
// beatAt, stamped by the builder on every step), the latest `build-request` (the title), the latest
// `activity` trail (built / QA / released), and the turn state. PURE; the page ticks the ages itself.
export const WORK_QUIET_MS = 90 * 1000;      // no step for this long → "quiet" (amber)
export const WORK_STALL_MS = 5 * 60 * 1000;  // no step for this long → "stalled" (red)
export const WORK_DONE_LINGER_MS = 30 * 60 * 1000; // a finished build stays on the strip this long
const buildTitle = (text = '') => String(text).replace(/^\[build request\]\s*/i, '').split(/\n/)[0].replace(/\s+—.*$/, '').trim().slice(0, 110);
export function activeWork({ rooms = {}, messagesByRoom = {}, now = Date.now() } = {}) {
  const out = [];
  for (const [roomId, room] of Object.entries(rooms)) {
    if (!room || seatKind(roomId, room) !== 'workshop') continue;
    const msgs = (messagesByRoom[roomId] || []).map((e) => e.m).filter(Boolean);
    const byTime = msgs.slice().sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    const req = byTime.find((m) => m.kind === 'build-request');
    const trail = byTime.find((m) => m.kind === 'activity' && /Build progress/.test(m.text || ''));
    const blocked = byTime.find((m) => /Blocked — needs input/i.test(m.text || ''));
    const hb = room.buildHeartbeat || {};
    const beatMs = tsMs(hb.beatAt);
    const turn = room.turn || {};
    const working = turn.turnState === 'working' || turn.turnState === 'queued';
    const lastMs = Math.max(beatMs, tsMs(req?.createdAt), tsMs(trail?.createdAt));
    if (!req && !working) continue;
    let state, stage;
    if (working) {
      const idle = beatMs ? now - beatMs : now - tsMs(req?.createdAt);
      state = idle > WORK_STALL_MS ? 'stalled' : idle > WORK_QUIET_MS ? 'quiet' : 'working';
      // The heartbeat's `step` is written for a build room — it is a command or a filename ("editing
      // composer-paste.spec.mjs", "running: grep -rn …"). The COUNT is what a director wants; the noun is
      // exactly what they do not ([ALT-BOARDROOM], and Oren, 3 Sep: "too technical — I don't want technical
      // information on the screen. I do want a frequent progress indicator so it feels like it's moving").
      // So the step number and the ticking age carry the movement, and the detail stays in the build room.
      stage = hb.stepNum ? `step ${hb.stepNum}` : hb.step ? 'working through it' : (turn.turnState === 'queued' ? 'queued — waiting for a free seat' : 'starting');
    } else if (turn.errored) {
      state = 'stuck'; stage = 'stopped on an error';
    } else if (blocked && tsMs(blocked.createdAt) >= tsMs(req?.createdAt)) {
      state = 'blocked'; stage = 'needs your input';
    } else if (room.waitingOn) {
      state = 'waiting'; stage = 'waiting for your tap';
    } else {
      if (now - lastMs > WORK_DONE_LINGER_MS) continue;
      state = 'done';
      const t = String(trail?.text || '').replace(/^📋 Build progress\s*/, '');
      stage = t ? snippet(t, 90) : 'finished';
    }
    // No build-request? Title the row from the director's own words — the newest genuinely-human line in the
    // room, never the contentless "a build" (Oren, 25 Sep: "a build · step 1 — it says nothing"). Exclude every
    // machine author (system/brain/Cleo — a director is none of these) and every machine post: the activity
    // strip, the build-request itself, and the kernel's event-wake handoff nudge (written as from 'Cleo',
    // kind 'event-wake', raw "[handoff] …" text — ADR-0232), so a nudge can never title the row. 'a build' is
    // the last resort only when the room holds no human text at all.
    const humanSaid = byTime.find((m) => {
      const text = String(m.text || '').trim();
      if (!text || /^\[handoff\]/i.test(text)) return false;
      if (/^(system|brain|cleo)$/i.test(String(m.from || ''))) return false;
      return m.kind !== 'activity' && m.kind !== 'build-request' && m.kind !== 'event-wake';
    });
    const title = req ? buildTitle(req.text) : (humanSaid ? buildTitle(humanSaid.text) : 'a build');
    out.push({ roomId, seat: seatName(roomId, room), title, state, stage, lastMs: beatMs || lastMs, ageMs: Math.max(0, now - (beatMs || lastMs)), stepNum: hb.stepNum || null });
  }
  const order = { stalled: 0, stuck: 1, blocked: 2, working: 3, quiet: 4, waiting: 5, done: 6 };
  out.sort((a, b) => (order[a.state] - order[b.state]) || (a.ageMs - b.ageMs));
  return out;
}
export const WORK_WORDS = Object.freeze({ working: 'working', quiet: 'still running, no step for a while', stalled: 'no step for 5 min — check it', stuck: 'stopped on an error', blocked: 'needs you', waiting: 'needs your tap', done: 'done' });

// ── Ops: one screen of the company's live plumbing ─────────────────────────────────────────────────────
// The five things a director asks when something feels off: what is stuck, what is waiting on me, is the Mac
// running the code that is on main, and are the two apps the current build. Every field is REAL data read
// from Firestore/version.json — a source that has not reported yet shows `reported:false`, never a made-up
// value. PURE; the page renders it and ticks the ages. Owning ask: "Rebuild the Ops screen" (5 Sep 2026).
export const shortSha = (s) => String(s || '').trim().replace(/^(?:[a-z]+-)+/, '').slice(0, 7);

// twoShaMatch — true when either sha is a prefix of the other (short vs full, 7 vs 40). Empty → false.
function twoShaMatch(a, b) {
  const x = String(a || '').trim(), y = String(b || '').trim();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

// OPS_BLOCK_STATES — the task-ledger states that mean "a build is not moving and it is not just queued".
export const OPS_BLOCK_STATES = Object.freeze(['needs-you', 'blocked', 'stalled', 'stuck']);

// OPS_RECENT_MS — the Ops screen shows what stopped in the last day by default (Oren, 5 Sep: 34 "blocked" of
// which most were day-old dead asks). Older stops stay one tap away ("show older"); a stop that needs a director
// is never hidden by age.
export const OPS_RECENT_MS = 24 * 3600000;

// ── Freshness (ADR-0164) — a screen that shows a stopped source's last numbers as if they were current is
// lying, and it lies most convincingly when the last numbers happened to look fine.
//
// 2026-09-22: the Mac sat 3.5 days behind main because `core.bare` had flipped and `git status` errored.
// main-follow DID catch it and wrote `error: "git status failed — checkout may be broken…"` to its state doc,
// then halted the tick — which is exactly right. But the Ops screen read only the two shas, so none of that
// reached a director; and with the tick halted the shas stopped moving, so the last matched pair kept
// rendering a green "✓ up to date" for three and a half days.
//
// Two rules, and they are the whole of this section:
//   (1) a source that has STOPPED reporting must read as stopped, never as its last good value;
//   (2) an error a source took the trouble to write must reach the screen.
// A source that has NEVER reported is a third, different statement ("not reported yet") and stays as it was —
// silence from something that never spoke is not the same as silence from something that just stopped.
export const KERNEL_STALE_MS = 2 * 3600000;  // main-follow ticks every 1800s (config.schedules) — four missed ticks

export function opsSnapshot({ tasks = null, needsYou = [], mainFollow = null, consoleFollow = null, consoleVersion = '', clientDeploy = null, now = Date.now(), recentMs = OPS_RECENT_MS, showOlder = false, kernelStaleMs = KERNEL_STALE_MS } = {}) {
  const items = Array.isArray(tasks?.items) ? tasks.items : [];

  // (1) blocked builds — every task that is stuck on something (needs-you / blocked / stalled / stuck), with
  // the plain-words reason the ledger already carries and links that prove it.
  const allBlocked = items
    .filter((t) => OPS_BLOCK_STATES.includes(t.state))
    .map((t) => ({
      title: t.title || 'a build',
      issue: t.issue || null,
      state: t.state,
      word: t.word || t.state,
      reason: t.next || t.reason || '',
      ageMs: t.at ? Math.max(0, now - t.at) : 0,
      links: t.links || {},
    }))
    .sort((a, b) => OPS_BLOCK_STATES.indexOf(a.state) - OPS_BLOCK_STATES.indexOf(b.state) || b.ageMs - a.ageMs);
  const isRecent = (b) => b.state === 'needs-you' || b.ageMs <= recentMs;
  const blockedBuilds = showOlder ? allBlocked : allBlocked.filter(isRecent);
  const olderCount = allBlocked.length - allBlocked.filter(isRecent).length;

  // (2) cards waiting on a director — collectNeedsYou already ranks them; carry the essentials.
  const decisions = (needsYou || []).map((c) => ({
    seat: c.seat, label: c.label, tone: c.tone, ageMs: c.ageMs, roomId: c.roomId, id: c.id,
  }));

  // (3) the Mac (kernel): the sha this process is running vs the sha on main right now. main-follow stamps
  // both every tick; while it is mid-restart it also carries from→to.
  const mf = mainFollow || {};
  // ADR-0190: "Running" is only ever the sha the process reported it booted on. The sha on DISK is not what runs (a
  // merge without a restart leaves them apart), so it is never shown in its place — no runningSha reads as unknown.
  const runningSha = mf.runningSha || '';
  const mainSha = mf.remoteHead || '';
  const kernelReported = !!(runningSha || mainSha);
  const kernelUpdatedAtMs = tsMs(mf.updatedAt) || 0;
  // ageMs is null when the doc carries no timestamp at all — that is "cannot confirm", not "fresh", so it
  // counts as stale while staying distinguishable in the wording.
  const kernelAgeMs = kernelUpdatedAtMs ? Math.max(0, now - kernelUpdatedAtMs) : null;
  const kernel = {
    reported: kernelReported,
    runningSha, mainSha,
    inSync: twoShaMatch(runningSha, mainSha),
    // ADR-0209: main-follow's own read of whether the PROCESS lags main on runtime code ('current' | 'behind' |
    // 'unknown'). A process behind main by docs only runs everything main runs.
    runtimeCurrent: mf.runtime === 'current',
    // ADR-0209: only an in-flight restart is taken from main-follow's `state`. Its `done` after a pull that skipped
    // the restart read "· done" on a Mac running hours-old code; the shas and the runtime read decide the rest.
    state: mf.state === 'restarting' ? 'restarting'
      : twoShaMatch(runningSha, mainSha) ? 'up to date'
        : mf.runtime === 'current' ? 'up to date (behind by docs only)'
          : (runningSha && mainSha ? 'behind' : 'unknown'),
    to: mf.to || null,
    updatedAtMs: kernelUpdatedAtMs,
    ageMs: kernelAgeMs,
    stale: kernelReported && (kernelAgeMs === null || kernelAgeMs > kernelStaleMs),
    // main-follow halts its tick on a broken checkout and writes WHY here. Carry it; the panel renders it.
    error: String(mf.error || '').slice(0, 200),
  };

  // (4) the console app this browser is running, and whether a newer console build is held back.
  const cf = consoleFollow || {};
  const heldFor = cf.heldFor || '';
  const cons = {
    reported: !!consoleVersion,
    version: shortSha(consoleVersion),
    latestSha: shortSha(heldFor),
    upToDate: !heldFor || twoShaMatch(consoleVersion, heldFor),
    holdReason: (!heldFor || twoShaMatch(consoleVersion, heldFor)) ? '' : (cf.reason || 'a newer build is waiting to publish'),
  };

  // (5) the currently deployed client app — read from its own telemetry doc if one exists; honest "not
  // reported yet" when nothing has written it (no fabricated version).
  const cd = clientDeploy || {};
  const clientApp = {
    reported: !!(cd.version || cd.sha),
    name: cd.name || cd.client || 'client app',
    version: shortSha(cd.version || cd.sha),
    updatedAtMs: tsMs(cd.updatedAt || cd.deployedAt) || 0,
  };

  return {
    blockedBuilds, decisions, kernel, console: cons, clientApp,
    counts: { blocked: blockedBuilds.length, decisions: decisions.length, older: olderCount, all: allBlocked.length },
    showOlder: !!showOlder,
  };
}

// ── Tasks view — a compact, scannable list (redesign, 5 Sep 2026) ─────────────────────────────────────────
// The Tasks screen shows one line per ask. Four bands, in this order:
//   • "Needs you" — genuinely waiting on a director decision (needs-you only). Pinned, most prominent.
//   • "Blocked"   — stuck on something that is NOT a director decision (money/pricing/Xero/migration/core-manifest
//     name their own next step). Its own band and count — never folded into "Needs you".
//   • "In flight" — everything still moving (stalled / stuck / building / qa / shipping / verifying / queued).
//   • "Done"      — finished/dropped work, collapsed out of view by default so the screen stays quiet.
// Each state carries a pill: a tone (colour class) + a small emoji, so a row reads at a glance.
export const TASK_NEEDS_STATES = Object.freeze(['needs-you']);
export const TASK_BLOCKED_STATES = Object.freeze(['blocked']);
export const TASK_ACTIVE_STATES = Object.freeze(['stalled', 'stuck', 'building', 'qa', 'shipping', 'verifying', 'queued']);
export const TASK_DONE_STATES = Object.freeze(['done', 'dropped']);
export const TASK_PILL = Object.freeze({
  'needs-you': { emoji: '🔴', tone: 'needs' },
  blocked:     { emoji: '⛔', tone: 'needs' },
  stalled:     { emoji: '⏸️', tone: 'warn' },
  stuck:       { emoji: '⚠️', tone: 'warn' },
  building:    { emoji: '🔨', tone: 'build' },
  qa:          { emoji: '🔍', tone: 'qa' },
  shipping:    { emoji: '🚀', tone: 'ship' },
  verifying:   { emoji: '🛰️', tone: 'ship' },
  queued:      { emoji: '⏳', tone: 'idle' },
  done:        { emoji: '✅', tone: 'done' },
  dropped:     { emoji: '⚪', tone: 'idle' },
});
export const taskPill = (s) => TASK_PILL[s] || { emoji: '•', tone: 'idle' };

// taskCategoryEmoji / shortTaskTitle — director feedback, 7 Sep 2026: task titles are long, technical build-request
// sentences and hard to scan. The state pill already carries an emoji per STATE; this gives each row a SECOND,
// content emoji (what kind of ask this is) so two rows in the same state still look different at a glance, and
// trims the title to a short phrase instead of the raw first sentence. Display-only — titleOf()'s full text still
// drives the kernel task-state machine (kernel/task-state-logic.mjs — consoleStateOf/consoleItem, projected by
// sidecars/task-ledger.mjs), untouched here.
const TASK_CATEGORY_RULES = Object.freeze([
  [/\b(invoice|xero|payment|pricing|money|gst|billing)\b/i, '💰'],
  [/\b(security|gate|wall|auth|credential|secret|token)\b/i, '🔒'],
  [/\b(deploy|ship|publish|release)\b/i, '🚀'],
  [/\b(ui|console|design|copy|text|emoji|render|screen|layout|sidebar)\b/i, '🎨'],
  [/\b(bug|fix|broken|error|crash|fail\w*)\b/i, '🐛'],
  [/\b(investigat\w*|check|verify|audit|review|reconcile)\b/i, '🔍'],
  [/\btests?\b|\bqa\b/i, '🧪'],
  [/\b(migrat\w*|database|\bdb\b|data model)\b/i, '🗄️'],
  [/\b(email|whatsapp|message|comms|notif\w*)\b/i, '💬'],
  [/\b(calendar|meeting|schedule)\b/i, '📅'],
  [/\b(docs?|readme|documentation)\b/i, '📄'],
]);
export function taskCategoryEmoji(title = '') {
  const t = String(title || '');
  for (const [re, emoji] of TASK_CATEGORY_RULES) if (re.test(t)) return emoji;
  return '🛠️';
}
export function shortTaskTitle(title = '', maxLen = 56) {
  let t = String(title || '').trim();
  const clauseBreak = t.search(/[:;,]| — | - /);
  if (clauseBreak > 12 && clauseBreak < maxLen) t = t.slice(0, clauseBreak).trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim() + '…';
}

// taskCardFor — ADR-0239: the waiting card a Tasks row shows inline with its buttons. The board names it on the row
// (`card: { room, id }`); a card raised since the last board tick is found by the task id it carries. Before this,
// `card` was never written, so no row ever showed a button (Cleo, 24 Sep: "no buttons. how do we progress?"). Pure.
export function taskCardFor(t = {}, needsYou = []) {
  const list = Array.isArray(needsYou) ? needsYou : [];
  if (t?.card?.room && t?.card?.id) {
    const hit = list.find((it) => it.roomId === t.card.room && it.id === t.card.id);
    if (hit) return hit;
  }
  return t?.id ? (list.find((it) => it?.m?.taskId && String(it.m.taskId) === String(t.id)) || null) : null;
}

// taskMatches — the search box filters on the plain title, the next-step words, the state word and #issue.
export function taskMatches(t = {}, q = '') {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const hay = [t.title, t.next, t.word, t.state, t.userWord, t.userStage, t.issue != null ? '#' + t.issue : '']
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}

// tasksView — pure: turns the ledger doc + the current query/showDone into the three bands the screen draws.
export function tasksView({ tasks = null, query = '', showDone = false, now = Date.now() } = {}) {
  const items = Array.isArray(tasks?.items) ? tasks.items : [];
  const q = String(query || '').trim();
  const matched = items.filter((t) => taskMatches(t, q));
  const band = (states) => states.flatMap((s) => matched.filter((t) => t.state === s));
  const needsYou = band(TASK_NEEDS_STATES);
  const blocked = band(TASK_BLOCKED_STATES);
  const active = band(TASK_ACTIVE_STATES);
  const done = band(TASK_DONE_STATES);
  return {
    needsYou, blocked, active, done,
    doneCount: done.length,
    showDone: !!showDone,
    total: items.length,
    matchedCount: matched.length,
    empty: items.length === 0,
    noMatch: items.length > 0 && q !== '' && matched.length === 0,
    updatedAtMs: tsMs(tasks?.updatedAt) || tasks?.updatedAtMs || 0,
    summary: tasks?.summary || '',
  };
}

// ── wake-word background listener (Talk screen) ───────────────────────────────────────────────────────
// The console's hands-free "Hey Cleo" listener may run ONLY when it is enabled AND no other mic user is
// active — the Talk-screen dictation mic and the wake recognizer can never hold the microphone at once
// (two live SpeechRecognition instances fight and one silently dies). This pure guard is what the runner
// checks before (re)arming the background recognizer; keeping it here makes the one rule unit-testable.
export function shouldArmWake({ enabled = false, micActive = false } = {}) {
  return !!enabled && !micActive;
}

// shouldReleaseWakeForDictation — one mic user at a time. Starting the dictation mic must release any
// armed background wake recognizer first; two recognizers contend for the mic and capture nothing (the
// green light shows but no words land). True only when the dictation mic is starting AND a wake recognizer
// is currently armed. Consumed by toggleMic() in now.js so the behavior is asserted, not just wired.
export function shouldReleaseWakeForDictation({ startingDictation = false, wakeArmed = false } = {}) {
  return !!startingDictation && !!wakeArmed;
}

// classifyMicError — turns a SpeechRecognition error code into how the UI must react, so the visible
// error-state is a tested decision and not only DOM-wired. A denied mic ('not-allowed'/'service-not-allowed')
// and an unreachable mic ('audio-capture') are TERMINAL: the caller drops the green indicator and shows a
// plain reason, so the light never sits green with nothing behind it. Every other code ('no-speech',
// 'aborted', 'network', …) is a transient blip to listen through — not terminal, no alert.
export function classifyMicError(errorCode) {
  if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed') {
    return { terminal: true, kind: 'permission' };
  }
  if (errorCode === 'audio-capture') {
    return { terminal: true, kind: 'capture' };
  }
  return { terminal: false, kind: null };
}

// ── ⚑ Flag this (P5, ADR-0050 flag-to-fix) ─────────────────────────────────────────────────────────────
// A director taps "⚑ Flag this" on any screen, types one line, and the console writes an hq message the
// flag-intake sidecar turns into a GitHub issue. These pure helpers assemble the payload and sanitise the DOM
// snapshot so the message carries no scripts/handlers and no bare emails/phones. No DOM, no clock (now injected).
export const FLAG_ACTIONS_MAX = 20;    // the recent-action ring
export const FLAG_ERRORS_MAX = 10;     // the console-error ring
export const FLAG_BOARD_MAX = 10;      // the visible board rows
export const FLAG_SNAPSHOT_MAX = 120 * 1024;

// pushAction — append an action to a bounded ring (newest last, ≤ FLAG_ACTIONS_MAX). Pure.
export function pushAction(ring = [], a = {}) {
  return [...(Array.isArray(ring) ? ring : []), a].slice(-FLAG_ACTIONS_MAX);
}

// sanitizeSnapshot — strip <script>/<style> blocks + inline on* handlers + javascript: URLs, mask bare emails and
// phone-like digit runs, and cap at 120KB. Belt over the server-side redactFlag (the kernel scrubs again).
export function sanitizeSnapshot(html = '') {
  let s = String(html || '');
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
       .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
       .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
       .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
       .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
       .replace(/javascript:/gi, 'blocked:');
  // mask bare emails and long phone-like digit runs (a last-4 tail is kept for a human to recognise)
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '•••@•••');
  s = s.replace(/(?:\+?\d[\d ()-]{7,}\d)/g, (m) => '•••' + m.replace(/\D/g, '').slice(-4));
  return s.slice(0, FLAG_SNAPSHOT_MAX);
}

// buildFlagPayload — the hq message (minus createdAt, which the caller stamps with serverTimestamp()). `ctx` is the
// captured page state; `intent` is the director's one line. Pure + deterministic. The snapshot is sanitised here;
// the flag-intake sidecar redacts again (client literals + secrets) before the issue is filed.
// flowItemLabel — a short, human label for a Flow item, used when a director RIGHT-CLICKS that item to
// request a change ("just like brickwise": the change request names the exact thing clicked, not the whole
// screen). PURE. Prefers the item's own title/label, falls back to the seat, then the roomId. No secrets,
// no client literals beyond what the item already shows on the director's own screen.
export function flowItemLabel(item = {}) {
  const it = item || {};
  const title = String(it.title || it.label || '').trim();
  const seat = String(it.seat || '').trim();
  const room = String(it.roomId || '').trim();
  const core = title || seat || room || 'this item';
  const prefix = seat && title ? `${seat} · ` : '';
  return `${prefix}${core}`.slice(0, 120);
}

export function buildFlagPayload(ctx = {}, intent = '', { now = Date.now(), author = 'a director' } = {}) {
  const c = ctx || {};
  // When the flag targets a specific Flow item (right-click), name it at the top of the filed text so the
  // resulting issue/build is unmistakably about THAT item — and keep the raw label on the flag for the
  // intake sidecar. A plain screen-level flag (no targetLabel) is unchanged.
  const targetLabel = String(c.targetLabel || '').slice(0, 120);
  const text = targetLabel
    ? `Change requested on: ${targetLabel}\n${String(intent || '')}`.slice(0, 500)
    : String(intent || '').slice(0, 500);
  const flag = {
    appVersion: String(c.appVersion || '').slice(0, 40),
    screen: String(c.screen || '').slice(0, 24),
    hash: String(c.hash || '').slice(0, 120),
    targetLabel,
    roomId: String(c.roomId || '').slice(0, 80),
    msgId: String(c.msgId || '').slice(0, 80),
    viewport: { w: Number(c.viewport?.w) || 0, h: Number(c.viewport?.h) || 0 },
    ua: String(c.ua || '').slice(0, 300),
    lang: String(c.lang || '').slice(0, 8),
    recentActions: (Array.isArray(c.recentActions) ? c.recentActions : []).slice(-FLAG_ACTIONS_MAX).map((a) => ({ at: Number(a?.at) || 0, action: String(a?.action || '').slice(0, 40), target: String(a?.target || '').slice(0, 120) })),
    consoleErrors: (Array.isArray(c.consoleErrors) ? c.consoleErrors : []).slice(-FLAG_ERRORS_MAX).map((e) => ({ at: Number(e?.at) || 0, msg: String(e?.msg || '').slice(0, 300) })),
    boardRows: (Array.isArray(c.boardRows) ? c.boardRows : []).slice(0, FLAG_BOARD_MAX).map((r) => String(r || '').slice(0, 200)),
    domSnapshot: sanitizeSnapshot(c.domSnapshot || ''),
    screenshot: null,
  };
  return {
    type: 'text', kind: 'flag', from: 'director', author: String(author || 'a director'),
    text, relayed: true, status: 'flag-new', flag,
  };
}

// ── the board (P5, ADR-0050): the console reads ${CONFIG}/board (the successor to ${CONFIG}/tasks) ──────────
// boardToTasks — adapt board.flow to the { items } shape tasksView/opsSnapshot already read, so the Tasks screen
// reads board.flow with no other change. Pure.
export function boardToTasks(board = null) {
  const b = board || {};
  return { items: Array.isArray(b.flow) ? b.flow : [], summary: b.summary || '', updatedAt: b.updatedAt || null, updatedAtMs: b.updatedAtMs || 0, drivePaused: b.drivePaused || null };
}

// ── The board's own age (ADR-0266) ──────────────────────────────────────────────────────────────────────
// 25 Sep 2026: the director's phone showed "5 held, 6 in flight" long after the board doc read "0 held, 0 stuck,
// 6 in flight" — a PWA resumed from background whose listener had stalled, with nothing on screen to say so. To a
// director a stale screen and a stalled pipeline look the same. So the board says how old it is, from the doc's
// own `updatedAt`, and when it is behind the page re-opens its listener once per window and then says whose it is.
//
// One threshold. The board job ticks every 60s (config.schedules.board.everySeconds); three missed ticks is not a
// slow run, it is behind. The job is `deferrable` (it yields the Mac to a call), so during a call the line will
// honestly say Cleo has not updated the board.
export const BOARD_STALE_MS = 3 * 60000;
// A listener re-opened this long ago that the SERVER has still not answered (only cache snapshots, or none) is the
// phone's connection, not the kernel — say so rather than "refreshing…" forever.
export const BOARD_ANSWER_MS = 60000;

// boardUpdatedMs — the board's own write time in ms, or 0 when it has none a clock can read. `updatedAt` is the
// server Timestamp the board job writes (a Timestamp, or {seconds} once serialised, or an ISO string / number from
// older writers); `updatedAtMs` is the job's own clock, the fallback while a serverTimestamp is still pending.
export function boardUpdatedMs(board = null) {
  const b = board || {};
  const pick = (v) => { const n = tsMs(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  return pick(b.updatedAt) || pick(Number(b.updatedAtMs));
}

// boardFreshness — the one line that says how old the board on this screen is, and whose fault it is when it is old.
// `live` is the page's listener record: { subscribedAt, serverAt, healedAt } — when the listener was last opened,
// when the SERVER last answered it (a snapshot not from cache), when the page last re-opened it to heal.
// States: 'unknown' (no readable time) · 'fresh' · 'refreshing' (behind; the page is re-opening its listener) ·
// 'offline' (this phone has no network) · 'unreachable' (re-opened, the server never answered) · 'kernel' (a
// listener opened AFTER the board went stale got the server's word, and it is still stale — Cleo, not the phone).
export function boardFreshness({ board = null, live = {}, now = Date.now(), online = true, staleMs = BOARD_STALE_MS, answerMs = BOARD_ANSWER_MS } = {}) {
  const at = boardUpdatedMs(board);
  if (!at) return { state: 'unknown', ageMs: null, behind: false, text: 'The board has not reported yet' };
  const ageMs = Math.max(0, now - at);
  if (ageMs <= staleMs) return { state: 'fresh', ageMs, behind: false, text: ageMs < 60000 ? 'Updated just now' : `Updated ${fmtAge(ageMs)} ago` };
  const age = fmtAge(ageMs);
  const sub = Number(live?.subscribedAt) || 0;
  const heard = Number(live?.serverAt) || 0;
  if (!online) return { state: 'offline', ageMs, behind: true, text: `Not updated for ${age}: this phone is offline` };
  if (sub && heard >= sub && sub - at > staleMs) return { state: 'kernel', ageMs, behind: true, text: `Cleo hasn't updated the board for ${age}` };
  if (sub && heard < sub && now - sub > answerMs) return { state: 'unreachable', ageMs, behind: true, text: `Not updated for ${age}: this screen isn't getting updates, reconnecting…` };
  return { state: 'refreshing', ageMs, behind: true, text: `Not updated for ${age}: refreshing…` };
}

// shouldHealBoard — may the page tear down and re-open its board listener now? Bounded: at most once per stale
// window, counted from the last heal. `reason` is 'visible' (the page came back), 'online' (the network came
// back) or 'tick' (the page's timer noticed the threshold crossed). A board that is fresh or has never reported
// needs no heal; an offline phone has nothing to reach. A 'kernel' verdict is not retried on the timer — the page
// says so and stops — but a phone coming back from background or offline checks once, since its listener may
// have died while it was away.
export function shouldHealBoard({ reason = 'tick', fresh = null, live = {}, now = Date.now(), online = true, staleMs = BOARD_STALE_MS } = {}) {
  if (!online || !fresh) return false;
  if (now - (Number(live?.healedAt) || 0) < staleMs) return false;
  if (fresh.state === 'fresh' || fresh.state === 'unknown' || fresh.state === 'offline') return false;
  if (fresh.state === 'kernel') return reason === 'visible' || reason === 'online';
  return true;
}

// healAction — WHAT a heal does, by how many heals this stale spell has already had (ADR-2610011413br). The first
// re-opens the board listener (the old heal). If the server still has not answered by the next window, the
// transport itself is the suspect — a long-poll stream that died under the page (Oren's screen, 1 Oct 2026:
// ERR_QUIC_PROTOCOL_ERROR, then 400 on the stale session, every button dead with no sign) — so the second heal
// closes and re-opens the Firestore network, and the third reloads the page: the one step that cannot leave a
// dead stream behind. `live.heals` counts heals since the board was last heard from; a server-answered snapshot
// resets it. Bounded: after 'reload' the page is new and the count starts over.
export function healAction(live = {}) {
  const n = Number(live?.heals) || 0;
  if (n <= 0) return 'resubscribe';
  if (n === 1) return 'reconnect';
  return 'reload';
}

// opsRows — the FIVE Ops rows the console draws from ${CONFIG}/board: Flow · Stuck · Fleet · Spend · Ships. Each
// row is { key, label, value, detail, tone }. A missing board reads as honest zeros (never a fabricated value).
export function opsRows(board = null) {
  const b = board || {};
  const flow = Array.isArray(b.flow) ? b.flow : [];
  const stuck = Array.isArray(b.stuck) ? b.stuck : [];
  const fleet = b.fleet || {};
  const spend = b.spend || {};
  const ships = Array.isArray(b.ships) ? b.ships : [];
  const inFlight = flow.filter((t) => !['done', 'dropped'].includes(t.state)).length;
  const needsYou = flow.filter((t) => t.state === 'needs-you').length;
  const lastShip = ships[0] || null;
  const regressed = ships.filter((s) => s.verdict === 'regressed').length;
  const capPct = spend.cap > 0 ? Math.round((Number(spend.today) || 0) / spend.cap * 100) : 0;
  // ADR-0100: Success-on-1 — the north star, computed live on board.so1. Does a founder instruction land first-try?
  // The rate counts only unambiguous friction (a read that became a build; an errored turn); warming up until a few
  // founder turns exist (never a fake 100%). Rendered as the TOP board row.
  const s1 = board && board.so1 ? board.so1 : null;
  const so1Row = (() => {
    if (!s1 || s1.fresh !== true || s1.so1 == null) {
      const n = (s1 && s1.samples) || 0;
      return { key: 'so1', label: 'Success-on-1', value: 'warming up', detail: `${n} founder turn${n === 1 ? '' : 's'} in 24h — measuring`, tone: 'ok' };
    }
    const pct = Math.round(s1.so1 * 100);
    const drag = [];
    if (s1.misroute) drag.push(`${s1.misroute} read→build`);
    if (s1.errored) drag.push(`${s1.errored} errored`);
    if (s1.noOutcome) drag.push(`${s1.noOutcome} no-outcome`);
    if (s1.stuckLimbo) drag.push(`${s1.stuckLimbo} stuck/limbo`);
    const detail = drag.length ? `${drag.join(', ')} of ${s1.samples} founder turns` : `clean — ${s1.samples} asks landed first-try`;
    // stuck/limbo is real friction even when the turn-rate is clean — nudge the tone if there's a backlog.
    const tone = (pct < 90 || (s1.stuckLimbo || 0) > 0) ? 'warn' : 'ok';
    return { key: 'so1', label: 'Success-on-1', value: `${pct}%`, detail, tone };
  })();
  // The board's age is NOT a row here (ADR-0266): boardFreshness says it once, above these rows, and it can tell
  // a board Cleo stopped writing from a phone that stopped listening — a row computed from the doc alone cannot.
  return [
    so1Row,
    { key: 'flow', label: 'Flow', value: `${inFlight} in flight`, detail: needsYou ? `${needsYou} need you` : `${flow.length} total`, tone: needsYou ? 'warn' : 'ok' },
    { key: 'stuck', label: 'Stuck', value: stuck.length ? `${stuck.length}` : 'none', detail: stuck.length ? String(stuck[0].title || '').slice(0, 80) : 'nothing is stuck', tone: stuck.length ? 'warn' : 'ok' },
    { key: 'fleet', label: 'Fleet', value: `${fleet.sidecars || 0} jobs`, detail: `${fleet.restarts24h || 0} restart${(fleet.restarts24h || 0) === 1 ? '' : 's'}/24h${fleet.safeMode ? ' · 🛡️ safe mode' : ''}`, tone: fleet.safeMode || (fleet.restarts24h || 0) > 24 ? 'warn' : 'ok' },
    { key: 'spend', label: 'Spend', value: `$${(Number(spend.today) || 0).toFixed(2)}`, detail: spend.cap ? `${capPct}% of $${spend.cap} cap` : 'no cap set', tone: capPct >= 100 ? 'warn' : 'ok' },
    { key: 'ships', label: 'Ships', value: ships.length ? `${ships.length} recent` : 'none', detail: lastShip ? `last: ${lastShip.verdict}${regressed ? ` · ${regressed} regressed` : ''}` : 'no ships yet', tone: regressed ? 'warn' : 'ok' },
  ];
}

// fableLedgerRows — the Fable tab reads ${CONFIG}/fableGate/ledger: the recent review decisions. Pure adapter.
export function fableLedgerRows(ledger = null, { cap = 20 } = {}) {
  const l = ledger || {};
  const rows = Array.isArray(l.reviews) ? l.reviews : (Array.isArray(l.entries) ? l.entries : []);
  return rows.slice(0, cap).map((r) => ({
    at: tsMs(r.at || r.ts || r.updatedAt) || 0,
    moment: String(r.moment || '').slice(0, 16),
    verdict: String(r.verdict || r.result || '').slice(0, 24),
    why: snippet(r.holdReason || r.why || r.summary || '', 120),
  }));
}

// shouldHoldScreenWakeLock — a live dictation session (the Talk-screen mic, `micOn`) must keep the phone's
// screen on, or the OS puts the display to sleep mid-sentence and the mic session (and the conversation)
// dies with it (director report, 7 Sep: "screen turns off... drops the mic session"). True exactly while a
// dictation session is active; false the instant it ends, so the caller releases the lock and normal sleep
// resumes. A backgrounded/hidden tab can never hold a lock in the browser anyway (the Wake Lock spec drops
// it), but the decision itself only cares about the mic — `document.visibilitychange` re-acquisition is the
// caller's job (browser wiring, not a policy choice).
// ADR-0200 — what the "PR ↗" control should be. `links.pr` does NOT always carry a URL: the kernel sets it
// from `refs.prNumber` (kernel/task-state-logic.mjs), a bare number, while `links.preview` beside it is a
// real URL. The row rendered both the same way, so a board row whose PR was #1021 produced
// `<a href="1021">`, which the browser resolved against the console and answered with
// `cleo2.pages.dev/elad-and-oren/1021` — 404 (Cleo, 23 Sep).
//
// A bare number cannot be turned into a URL here: `refs` carries no repo, and the room -> repo map lives in
// `config.build.targets.<room>.githubRepo`, which this page never reads. Guessing one would be a link that
// silently points at the wrong repository — worse than no link. So a number renders as TEXT ("PR #1021"),
// which is true and never 404s, and only a real http(s) URL renders as a link. Carrying the URL itself on
// `refs` is the actual fix and is a core change; until then this tells the truth about what it has.
export function prLink(pr) {
  if (pr == null || pr === '') return null;
  const raw = String(pr).trim();
  if (/^https?:\/\//i.test(raw)) return { href: raw, text: 'PR ↗' };
  const n = raw.replace(/^#/, '');
  return /^\d+$/.test(n) ? { href: null, text: `PR #${n}` } : null;
}

export function shouldHoldScreenWakeLock({ micOn = false } = {}) {
  return !!micOn;
}

// attachmentsView — the attachments a message carries, ready to render as their OWN visible, clickable
// elements instead of a bare `📎 …long-URL…` line buried in the body (director flag #195: "when I attach a
// file, I want to SEE it on the card and click it"). Reads the two structured fields the composer already
// writes onto the message doc: `images` (inline data/http URLs) and `driveFiles` ({id,name,mimeType,size,
// webViewLink}). PURE — no DOM, no I/O. Only http(s)/data image sources and http(s) file hrefs survive; a
// drive file with no webViewLink falls back to its canonical /file/d/<id>/view link (never a relative href,
// so nothing can point back at our own origin). Returns { images:[url], files:[{name,href,kb}] }.
const SAFE_HTTP = /^https?:\/\//i;
const SAFE_IMG_SRC = /^(https?:\/\/|data:image\/)/i;
export function attachmentsView(m = {}) {
  const images = (Array.isArray(m.images) ? m.images : [])
    .map((u) => String(u ?? '').trim())
    .filter((u) => SAFE_IMG_SRC.test(u));
  const files = (Array.isArray(m.driveFiles) ? m.driveFiles : [])
    .map((f) => {
      if (!f) return null;
      const name = String(f.name ?? '').trim() || 'file';
      let href = String(f.webViewLink ?? '').trim();
      if (!SAFE_HTTP.test(href)) href = f.id ? `https://drive.google.com/file/d/${encodeURIComponent(String(f.id))}/view` : '';
      if (!href) return null;
      const kb = Number(f.size) > 0 ? Math.max(1, Math.round(Number(f.size) / 1024)) : 0;
      return { name, href, kb };
    })
    .filter(Boolean);
  return { images, files };
}

// ── card triage + card view (ADR-0252) ──────────────────────────────────────────────────────────────────
// 24 Sep 2026, 22:09Z: the Now board held eight cards and every one was dropped by hand. Their work had already
// landed (a stuck card whose task the board showed done; three "ship Cleo's change" cards whose code was on main as
// #360), or they were copies of one change at different commits, or a heads-up that asked nothing. And each card led
// with the kernel's vocabulary (can-destabilise, branch @ sha, shadow read) and never said what a button would do.
// Two pure functions change what the screen shows. Neither writes anything: a hidden card keeps its doc, its buttons
// and its executor, and still opens from the "cleared" line. The kernel's own sweep is the core half (ADR-0252 §2).

// The cards a TASK-DRIVER / SHIP-GATE hold raises — the only ones whose meaning is "this task is held". A client send,
// a ship approval or a consensus decision is about its own act, so its task moving on never clears it here.
const HOLD_CARD_SUBKINDS = new Set(['rebuild', 'fable-hold', 'stop-switch', 'dead-build', 'design', 'infra', 'client-input', 'product-choice', 'money', 'db-destructive']);
const isHoldCard = (m = {}) => m.type === 'question'
  && (m.requestedBy === 'task-driver' || String(m.subkind || '') === 'fable-hold')
  && HOLD_CARD_SUBKINDS.has(String(m.subkind || m.kind || ''));

// isHeadsUp — a card that tells, not asks: the spend governor's over-budget note while work carries on. It has one
// button ("Got it", a kernel no-op, gate.mjs spend-ack) and decides nothing. A PAUSED room is a real ask and stays.
export function isHeadsUp(m = {}) {
  if (String(m.kind || '') !== 'spend-alert') return false;
  return !/PAUSED/.test(String(m.body || m.text || ''));
}

// triageNeedsYou — split the ranked Needs-you list into what a director decides, heads-ups, and cards whose question
// is already answered by the world. `flow` is board.flow (consoleItem rows: { id, state, title }). A card is cleared:
//   • 'finished' — a hold card whose task the board shows done or dropped, or no longer held (it moved to build, QA or
//     ship: whatever the card asked has happened). A task the board does not list proves nothing, so the card stays.
//   • 'older'    — a hold card for the same change as a newer one: the same task and kind, or a fable-hold on the
//     same branch (a later commit on a seat branch carries the earlier ones). The newest stays.
// Returns { decisions, headsUp, cleared: [{ ...item, clearedWhy }] }, each keeping the input order.
export function triageNeedsYou(needsYou = [], { flow = [] } = {}) {
  const tasks = new Map((Array.isArray(flow) ? flow : []).filter((t) => t && t.id).map((t) => [String(t.id), t]));
  const decisions = [], headsUp = [], cleared = [];
  const newest = new Map(); // change key → the newest item
  const changeKey = (it) => {
    const m = it.m || {};
    if (!isHoldCard(m)) return null;
    // Every self change parks on the same branch (brain/coo-build), so the branch alone named ALL of them as one
    // change and only the newest parked card stayed a decision (1 Oct 2026: four Fable-passed changes, three hidden).
    // The task names the change; the branch is the fallback for a legacy card with no task.
    if (String(m.subkind) === 'fable-hold' && m.branch) return `fh|${it.roomId}|${m.branch}${m.taskId ? `|${m.taskId}` : ''}`;
    return m.taskId ? `t|${m.taskId}|${m.subkind || m.kind}` : null;
  };
  for (const it of needsYou) {
    const k = changeKey(it);
    if (k && (!newest.has(k) || (it.ts || 0) > (newest.get(k).ts || 0))) newest.set(k, it);
  }
  for (const it of needsYou) {
    const m = it.m || {};
    if (isHeadsUp(m)) { headsUp.push(it); continue; }
    const task = isHoldCard(m) && m.taskId ? tasks.get(String(m.taskId)) : null;
    if (task && !['needs-you', 'blocked'].includes(task.state)) {
      cleared.push({ ...it, clearedWhy: task.state === 'dropped' ? 'Its task was dropped.' : task.state === 'done' ? 'Its work is done.' : 'Its task moved on without it.' });
      continue;
    }
    const k = changeKey(it);
    if (k && newest.get(k) !== it) { cleared.push({ ...it, clearedWhy: 'A newer card asks about the same change.' }); continue; }
    decisions.push(it);
  }
  return { decisions, headsUp, cleared };
}

// OPTION_DOES — what each button the kernel offers actually does, in one line, from its executor
// (rooms.handleRebuildDecision, handleFableHold, handleNeedsInputDecision, gate spend-ack). The button still sends
// the kernel's exact option string; only the line under it is new. An option not listed gets no line (never a guess).
export const OPTION_DOES = Object.freeze({
  'Rebuild now': 'Runs the build once more with the same brief.',
  "It's done, rebuild": 'Tap once the missing thing is added. Runs it again.',
  'Retry': 'Sends it back to the builder once more.',
  'Drop it': 'Closes it. Nothing ships.',
  'Keep it': 'Leaves it on Tasks for someone to pick up.',
  'Done elsewhere': 'Closes it as shipped, because it landed another way.',
  'Close it': 'Closes it as done, on your word.',
  'Open as an issue': 'Files it on GitHub for a core session and closes this row.',
  'Leave it held': 'Nothing changes. It stays held.',
  'Reject': 'Drops the task. Nothing ships.',
  'Ship it anyway (single-tap)': 'Sends it to release. Nothing ships without this tap.',
  'Rework with my note': 'Asks you for a note, then sends it back to be reworked. Nothing ships.',
  'Got it': 'Clears this note. Nothing else changes.',
});
// A friendlier face for a kernel option whose own words are engineering words. The tap still sends the original.
const OPTION_LABEL = Object.freeze({ 'Ship it anyway (single-tap)': 'Ship it', 'Rework with my note': 'Send it back' });

// A stop-switch card raised before ADR-2609291337tb (one director plus Fable's review) still carries the old rule's words
// and a leave-waiver button. The kernel already signs on any "I sign it…" answer (rooms.mjs isSignAnswer), so the card
// works; only its words are stale (30 Sep: HQ Lab, lesson-loading and four more still read under the old rule). These show
// it under today's rule without touching the card: the tap still sends the original option value.
const LEGACY_OPTION_LABEL = Object.freeze({ 'I sign it (leave waiver)': 'I sign it' });
const LEGACY_OPTION_HIDDEN = /^Wait for both\s/; // the old rule's wait-for-the-other-signer button
export function currentRuleText(text = '') {
  return String(text || '')
    .replace(/it needs BOTH\s+directors[’']\s*sign-off before it can go live/gi, 'it needs one director’s sign-off, after Fable’s review, before it can go live')
    .replace(/\S+ is away until [^,]*, so your sign-off alone releases it\./g, 'One director’s sign-off, after Fable’s review, releases it.')
    // 30 Sep 02:28 (issue #440): the lesson-loading item's card still opened with the driver's old head that counted
    // signatures, "Needs … (a stop-switch change)." One director plus Fable's review is the rule (ADR-2609291337tb).
    .replace(/\b(Needs|needs|need) two\s+directors[’']?\b/g, '$1 one director’s signature, after Fable’s review');
}

// BANNED_CARD_JARGON — the internal/engineering vocabulary a director must NEVER read on a card (the founder flag,
// 2026-10-01: "what is this language, how am I supposed to understand what decision I need to make"). Each entry is
// an ordered { re, plain } rewrite; `hasBannedJargon` is the same token set as a single detector the guard test
// asserts against. Order matters — the compound phrases ("one director's sign-off, after Fable's review", which
// currentRuleText itself emits) are rewritten before the bare tokens, so a residual "sign-off"/"Fable" never leaks.
const BANNED_CARD_JARGON = Object.freeze([
  [/\btwo[-\s]?directors?[’'`]?\s*sign[-\s]?off\b/gi, 'your approval'],
  [/\bone director[’'`]?s?\s*sign[-\s]?off,?\s*after\s*Fable[’'`]?s?\s*review\b/gi, 'a safety review and your approval'],
  [/\bFable[’'`]?s?\s*(?:sign[-\s]?off|review)\b/gi, 'a safety review'],
  [/\bcore[-\s]?manifest\s*change\b/gi, 'a change to Cleo’s safeguards'],
  [/\bcore[-\s]?change\b/gi, 'a change to Cleo’s safeguards'],
  [/\brelease machinery\b/gi, 'the release process'],
  [/\bsend gate\b/gi, 'the approval step'],
  [/\bpropose[-\s]?only\b/gi, 'waiting for your OK'],
  [/\bQA[-\s]?hold\b/gi, 'held for a check'],
  [/\bstop[-\s]?switch(?:[-\s]?core)?\b/gi, 'Cleo’s safeguards'],
  [/\bhand[-\s]?off\b/gi, 'pass-off'],
  [/\btwo[-\s]?director\b/gi, 'your'],
  [/\bsign[-\s]?off\b/gi, 'approval'],   // residual bare token, last
]);
// the detector the guard test uses — the SAME token set, as one alternation. Kept in lock-step with the table above.
const BANNED_CARD_JARGON_RE = /\b(?:two[-\s]?directors?[’'`]?\s*sign[-\s]?off|Fable[’'`]?s?\s*(?:sign[-\s]?off|review)|core[-\s]?(?:manifest\s*)?change|release machinery|send gate|propose[-\s]?only|QA[-\s]?hold|stop[-\s]?switch(?:[-\s]?core)?|hand[-\s]?off|sign[-\s]?off)\b/i;
export function hasBannedJargon(text = '') { return BANNED_CARD_JARGON_RE.test(String(text || '')); }

// plainizeDirectorText — the ONE pass that makes a card's words director-readable: first the stale-rule rewrite
// (currentRuleText), then every banned-jargon token → plain words. Every headline/why/body a director reads on a
// card runs through this, so the engineering vocabulary can never reach the Now/Agent screens. Pure.
export function plainizeDirectorText(text = '') {
  let out = currentRuleText(text);
  for (const [re, plain] of BANNED_CARD_JARGON) out = out.replace(re, plain);
  return out;
}

const APPROVAL_ASK = Object.freeze({ send: 'Send this message to the client?', ship: 'Ship this to production?', money: 'Approve this payment?' });
const stripLead = (s) => String(s || '').replace(/^[\s\p{Extended_Pictographic}️]+/u, '').trim();
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

// cardView — what a card SAYS, top to bottom: who it is for, the question in plain words, one line on why it is the
// director's, each button with what it does, and the rest folded into Details (nothing the kernel wrote is lost:
// `full` is its whole text). `it` is a collectNeedsYou item; `taskTitle` the board's title for its task, if any. Pure.
export function cardView(it = {}, { taskTitle = '' } = {}) {
  const m = it.m || {};
  const family = cardFamily(m);
  const tone = it.tone || cardLabel(m).tone;
  const full = plainizeDirectorText(m.text || m.body || m.title || '');
  const who = m.type === 'alert' ? { label: 'Needs a person', tone: 'alert' }
    : tone === 'send' ? { label: 'Client message', tone: 'client' }
    : tone === 'money' ? { label: 'Money', tone: 'money' }
    : m.type === 'decision' ? { label: 'Each of you', tone: 'both' }
    : family === 'stop-switch' ? { label: 'You, with Fable', tone: 'you' }
    : { label: 'You', tone: 'you' };
  const opts = Array.isArray(m.options) ? m.options.map(String).filter((o) => !LEGACY_OPTION_HIDDEN.test(o)) : [];
  const rec = m.default != null ? String(m.default) : String(m.recommendation || opts[0] || '');
  const options = opts.map((o) => ({ value: o, label: OPTION_LABEL[o] || LEGACY_OPTION_LABEL[o] || o, does: OPTION_DOES[o] || '', rec: o === rec }));
  const details = [];
  const title = plainizeDirectorText(String(m.title || '').replace(/^(Needs you|Stuck):\s*/, '').trim()) || String(taskTitle || '').trim();
  let headline = '', why = '';
  if (String(m.subkind || '') === 'fable-hold') {
    const v = m.shadowVerdict || null;
    const name = String(taskTitle || '').trim();
    headline = `Ship Cleo's change${name ? `: ${name}` : ''}?`;
    why = v && v.verdict === 'pass'
      ? 'Fable checked it and passed it. It changes Cleo’s own code, and a later deploy can undo it.'
      : `Fable held it${v && v.holdReason ? `: ${v.holdReason}` : ''}. It changes Cleo’s own code.`;
    if (m.branch || m.sha) details.push(['Change', `${m.branch || ''}${m.sha ? ` @ ${String(m.sha).slice(0, 7)}` : ''}`.trim()]);
    if (m.tier) details.push(['Tier', String(m.tier)]);
  } else if (isHoldCard(m) || m.requestedBy === 'task-driver') {
    // The task-driver's first line is `⏳ "<title>" is stuck: <what>` or `🫵 "<title>" needs <ask>.`
    const lead = stripLead(firstLine(full));
    const q = lead.match(/^"(.+?)"\s+(is stuck:|needs)\s*(.*)$/);
    headline = (q ? q[1] : title) || snippet(lead, 90);
    why = q ? (q[2] === 'is stuck:' ? `Stuck: ${q[3]}` : `Needs ${q[3]}`) : '';
  } else if (m.type === 'approval') {
    // The body of an approval IS the thing approved (an email, a message); it is shown whole, never as a headline.
    headline = title || APPROVAL_ASK[tone] || 'Approve this?';
    why = tone === 'send' ? 'It leaves the company when you tap Send, and cannot be taken back.' : '';
  } else {
    // No title: the first sentence is the question, the rest of the note is the why (never a clipped paragraph).
    const text = stripLead(full).replace(/\s+/g, ' ').trim();
    const cut = text.search(/[.?!](\s|$)/);
    const first = cut > 0 && cut < 160 ? text.slice(0, cut + 1) : text;
    headline = title || snippet(first, 140);
    why = title ? snippet(text, 200) : snippet(text.slice(first.length), 240);
  }
  if (m.recommendation && !opts.includes(String(m.recommendation))) details.push(['Cleo suggests', plainizeDirectorText(String(m.recommendation))]);
  // A client message is shown whole, above the buttons: the director must read exactly what will be sent.
  const showFull = tone === 'send' || m.type === 'approval';
  // Every line a director reads leads plain — the headline/why pass through plainizeDirectorText so no card can
  // reach the Now/Agent screens carrying engineering vocabulary (the 2026-10-01 founder flag).
  return { who, headline: snippet(plainizeDirectorText(headline), 140), why: snippet(plainizeDirectorText(why), 240), options, details, full, showFull };
}

// cardLeadsPlain — the acceptance predicate the guard test asserts: a card's FIRST line (its headline) is a non-empty
// decision/result and carries NO banned jargon. A `cardView` result in, a boolean out. Pure.
export function cardLeadsPlain(view = {}) {
  const h = String(view && view.headline || '').trim();
  return h.length > 0 && !hasBannedJargon(h) && !hasBannedJargon(String(view.why || ''));
}

// otherRoute — ADR-0252: where words a director types into "Other…" go. Every card has Other, and the words always
// reach something that acts on them. Two routes:
//   • 'answer'  — the card's own executor reads free text: a seat's own question (the gate re-enters the seat with the
//     words) and the four input holds (handleNeedsInputDecision resumes the build with them, and parks on a refusal).
//     The card closes; the seat's reply shows in Talk.
//   • 'message' — a card whose buttons run deterministic code (a held change, a stuck build, a ship, a send, a
//     consensus call, a heads-up). Typed words written as its answer would run no button and consume the card, so a
//     held task could lose its only card, and on a stop-switch "reject" typed as text drops it. Here the words go into
//     the card's room as the director's message, the seat acts on them, and the card STAYS OPEN with its buttons.
const ANSWER_SUBKINDS = new Set(['money', 'db-destructive', 'client-input', 'product-choice']);
export function otherRoute(m = {}) {
  const k = String(m.subkind || m.kind || '');
  if (m.type !== 'question') return 'message';
  if (m.requestedBy === 'task-driver') return ANSWER_SUBKINDS.has(k) ? 'answer' : 'message';
  if (isHoldCard(m) || k === 'prod-ship' || k === 'spend-alert' || k === 'selfmod-core' || k === 'leave-declare' || k === 'auto-rollback'
    || k === 'rebuild' || k === 'architect' || k === 'delegate' || k === 'reconcile-approve' || /^brickwise-/.test(k) || cardFamily(m) !== 'needs-input') return 'message';
  return 'answer';
}

// signOffCard — the one card that carries a director's SIGNATURE on a core change: the core-change card whose
// options include "I sign it" (STOP_SWITCH_OPTIONS; a card raised before ADR-2609291337tb reads "I sign it (…)").
// handleSelfmodDecision ships on that tap, so it is signed on its card in Classic, where the change it signs is shown.
export function signOffCard(m = {}) {
  return Array.isArray(m.options) && m.options.some((o) => /^I sign it\b/.test(String(o)));
}
// plainAnswerCard — the cards whose Now-screen buttons are plain `answer` taps (the last branch of cardHtml's taps:
// status answered + the option, stamped by decide() with the director's verified identity). Cleopatra answers
// exactly these, through the same decide(). ADR-2610040804an: a held task's stop-switch card ("Open as an issue" /
// "Drop it", "Leave it held" / "Reject") is one of them: before, the whole stop-switch family was refused, so the
// director saw her options greyed under "answered on its card in Classic". Only the signature itself stays on its card.
export function plainAnswerCard(m = {}) {
  if (m.type === 'alert' || m.type === 'decision' || m.type === 'approval' || m.type === 'qa-plan-escalation') return false;
  if (signOffCard(m)) return false; // the core-change signature is signed on its own card
  if ((m.subkind || m.kind) === 'selfmod-core' && !(Array.isArray(m.options) && m.options.length)) return false;
  return Array.isArray(m.options) && m.options.length > 0;
}

// ── Agents view (ADR-0274): the console's "agents" prototype, made real ─────────────────────────────────────
// One management surface: every seat, the work it owns, each item's ONE authoritative column, and the split a
// director actually acts on — a seat stuck on ITSELF (idle/errored with live work, needs a kick) vs a tap stuck on
// YOU (a pending money or core sign-off). Pure: it composes the SAME authoritative sources the rest of the screen
// reads — seatsOverview(rooms) for the seats, board.flow (consoleItem: `room`=owner, `userStage`=column, `state`)
// for the work, collectNeedsYou's ranked cards for the taps. It re-derives NO state from prose (doctrine #3), opens
// no new path, and decides nothing — the kick is the director's own message into the room, the taps keep their own
// existing card buttons where they live.

// AGENT_COLUMNS — the swim-flow, in the founders' words, mapped 1:1 from the kernel's five user-stages
// (kernel/task-state-logic.mjs USER_STAGES: queue | build | QA | wait-for-deploy | live). No new vocabulary.
export const AGENT_COLUMNS = Object.freeze([
  { key: 'queue', label: 'Asked' },
  { key: 'build', label: 'Being built' },
  { key: 'QA', label: 'Being checked' },
  { key: 'wait-for-deploy', label: 'Waiting for OK' },
  { key: 'live', label: 'Sent out' },
]);
const AGENT_COLUMN_LABEL = Object.freeze(Object.fromEntries(AGENT_COLUMNS.map((c) => [c.key, c.label])));
const AGENT_COLUMN_KEYS = new Set(AGENT_COLUMNS.map((c) => c.key));
// The board states that mean a seat is actively holding the item RIGHT NOW (a builder/reviewer/ship turn should be
// running). A `queued` item is waiting for a free seat, not owned — so it never makes an idle seat look stuck.
const AGENT_OWNED_STATES = new Set(['building', 'stalled', 'stuck', 'qa', 'shipping', 'verifying']);

// tapFloor — which of the human-only floors a director tap sits on: 'money' (W1/W6), 'core' (a director
// sign-off, W5/GATE-CORE), 'send' (client contact, W2), or null (an ordinary decision). Reads the SAME cardLabel
// tone + cardFamily the Needs-you list already uses — no new classification. These are the taps that MUST stop for a
// person; the surface batches them in one place so the pipeline can otherwise run without one.
export function tapFloor(m = {}) {
  const { tone } = cardLabel(m);
  if (tone === 'money') return 'money';
  if (m.type === 'decision' || cardFamily(m) === 'stop-switch') return 'core'; // a stop-switch sign-off / consensus decision
  if (tone === 'send') return 'send';
  return null;
}

// laneAutonomy — a build lane's ship posture, in plain words, for the Agents surface. `lane` is a descriptor
// { autoShip } mirrored from config.build.targets (the console cannot read server config — same reason the LLM
// account roster is mirrored in now.js). Returns null for any seat that is NOT a build lane (a company or client
// seat ships no code), so a row never invents an autonomy it does not have. This only SHOWS the dial; it can never
// change it — the grant policy is core (W5/GATE-CORE), untouched here.
export function laneAutonomy(lane = null) {
  if (!lane || typeof lane !== 'object') return null;
  const autoShip = lane.autoShip === true;
  return { autoShip, label: autoShip ? 'Ships itself once checks pass' : 'Waits for your OK to ship' };
}

// agentsView — the whole management surface as pure data. Inputs: `rooms` (the room mirror), `board` (the
// elad-oren-config/board doc), `needsYou` (collectNeedsYou's ranked list), `lanes` (roomId → { autoShip } from
// config.build.targets, mirrored in now.js). Returns:
//   • columns      — AGENT_COLUMNS (for the header)
//   • seats        — every seat row (seatsOverview) enriched with { items[], pendingTap, agentStuck, kickable, autonomy }
//   • agentStuck   — the seats needing a kick (a real error, or idle while still owning live work), never a
//                    seat that is merely waiting on a director tap (that is stuck-on-you, not stuck-on-an-agent)
//   • directorTaps — the ranked taps, each tagged with its floor (money | core | send | null) — the batched view
//   • counts       — { seats, agentStuck, taps, money, core, inFlight }
export function agentsView({ rooms = {}, board = null, needsYou = [], lanes = {}, now = Date.now() } = {}) {
  const seats = seatsOverview({ rooms, now });
  const flow = Array.isArray(board?.flow) ? board.flow : [];
  const byRoom = new Map();
  let inFlight = 0;
  for (const t of flow) {
    if (!t || t.state === 'done' || t.state === 'dropped') continue;
    inFlight++;
    const room = String(t.room || '');
    const col = AGENT_COLUMN_KEYS.has(t.userStage) ? t.userStage : 'queue';
    const item = {
      id: t.id || null, title: String(t.title || 'a build'), column: col, columnLabel: AGENT_COLUMN_LABEL[col],
      state: t.state, word: t.word || t.state, issue: t.issue || null, ageMs: t.at ? Math.max(0, now - tsMs(t.at)) : 0,
    };
    if (!byRoom.has(room)) byRoom.set(room, []);
    byRoom.get(room).push(item);
  }
  const directorTaps = (Array.isArray(needsYou) ? needsYou : []).map((it) => ({ ...it, floor: tapFloor(it.m || {}) }));
  const tapRooms = new Set(directorTaps.map((it) => String(it.roomId || '')));
  const seatRows = seats.map((s) => {
    const items = byRoom.get(s.id) || [];
    const pendingTap = tapRooms.has(s.id);
    // stuck-on-an-agent: the seat should be moving but is not, and it is NOT waiting on a director. A real error
    // (seatState 'stuck'), or an idle seat still owning live work (a build it dropped without finishing or carding —
    // the report-back gap). A seat waiting on YOU is a director tap, not a kick.
    const owned = items.some((i) => AGENT_OWNED_STATES.has(i.state));
    const agentStuck = !pendingTap && (s.state === 'stuck' || (s.state === 'idle' && owned));
    return { ...s, items, pendingTap, agentStuck, kickable: agentStuck, autonomy: laneAutonomy(lanes[s.id] || null) };
  });
  const agentStuck = seatRows.filter((s) => s.agentStuck);
  return {
    columns: AGENT_COLUMNS,
    seats: seatRows,
    agentStuck,
    directorTaps,
    counts: {
      seats: seatRows.length,
      agentStuck: agentStuck.length,
      taps: directorTaps.length,
      money: directorTaps.filter((t) => t.floor === 'money').length,
      core: directorTaps.filter((t) => t.floor === 'core').length,
      inFlight,
    },
  };
}

// otherMessage — the director's typed words as the room message the seat reads: it names the card it is about, so
// the seat knows which question the words answer. Pure.
export function otherMessage(headline = '', words = '') {
  const h = String(headline || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const w = String(words || '').trim();
  return h ? `About the card "${h}": ${w}` : w;
}
// saidOnCardFields — what the room message carries so the kernel knows which card and task the words are about
// (ADR-0253 of #370 threads `taskId` into the turn only when `saidOnCard` is set). PURE.
export function saidOnCardFields(cardId, m = {}) {
  return { saidOnCard: String(cardId || '') || null, taskId: m.taskId ? String(m.taskId) : null };
}

// cardIssues — every Brickwise issue a staged client message is about. A message drafted from an Agent View item
// names one (`meta.issueNumber`); the autopilot's questions card names several (`meta.issues`). Agent View must read
// both, or a question the autopilot sent Ohad never shows "Waiting for Brickwise's answer" on its item. PURE.
export function cardIssues(meta = {}) {
  const m = meta || {};
  const all = [m.issueNumber, ...(Array.isArray(m.issues) ? m.issues : [])].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(all)];
}

// sentAsksOf — what Agent View knows about questions to customers, from the rooms' messages ({ roomId: [{ id, m }] }):
//   { issue, room, at }  — a director-approved client message (`isSend(m)`) about that issue;
//   { title, room, at }  — one drafted from an item whose request carried no issue number: the card's thread root is the
//                          director's "Draft a message to <customer> about "<item title>": …" (hq-agents draftAsk), so the
//                          item is found by that title (30 Sep: three questions to Ohad about #836 reached the cards
//                          with no issue, and the item still read "waiting for The Brick Pit to confirm");
//   { reply: true, room, at } — a message in from the customer's WhatsApp group.
// The card's own meta wins; the request it answers is read only when the card names no issue. PURE.
export function sentAsksOf(messagesByRoom = {}, isSend = () => false) {
  const out = [];
  for (const [room, entries] of Object.entries(messagesByRoom || {})) {
    const list = Array.isArray(entries) ? entries : [];
    const byId = new Map(list.map((e) => [e && e.id, (e && e.m) || {}]));
    for (const e of list) {
      const m = (e && e.m) || {};
      if (m.source === 'whatsapp') { const at = tsMs(m.createdAt); if (at) out.push({ reply: true, room, at }); continue; }
      if (m.type !== 'approval' || m.status !== 'approved' || !isSend(m)) continue;
      const at = tsMs(m.decidedAt) || tsMs(m.createdAt) || 0;
      const origin = byId.get(m.threadId) || {};
      const issues = cardIssues({ ...(m.meta || {}), issues: [...((m.meta && Array.isArray(m.meta.issues)) ? m.meta.issues : []), origin.draftIssue] });
      for (const issue of issues) out.push({ issue, room, at });
      if (issues.length) continue;
      const title = draftTitleOf(origin.text);
      if (title) out.push({ title, room, at });
    }
  }
  return out.sort((a, z) => z.at - a.at);
}
// draftTitleOf — the item title in a director's "Draft a message to X about "<title>": …" request, or ''. PURE.
export function draftTitleOf(text = '') {
  const first = String(text || '').split('\n')[0];
  const hit = first.match(/^Draft a message to .*? about "(.*)": /);
  return hit ? hit[1].trim() : '';
}

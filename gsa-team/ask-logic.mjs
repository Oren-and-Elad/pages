// ask-logic.mjs — the branded page of an ANSWERER room (ADR-2610281312jh): `ask.html#<room>` shows ONE room's questions
// and answers, in its client's own look, with nothing else of the console on screen (no room list, no other client, no
// note). The relay answers there from the room's loopback answerer only (kernel2/answerer-logic.mjs). Only a room this
// table names opens; any other id is refused. A room with `prepared` also shows its prepared answers as tabs beside the
// live question (Oren, 2 Nov 2026, #gsa: "one experience"): the encrypted static page that URL serves, decrypted in the
// browser with its access code, so they open with the Mac off. PURE: no DOM, no Firestore.
// a prepared answer's locked frame: no scripts, no requests, inline styles and data: images only (was Cleo's
// dashboard-logic.mjs CARD_CSP; GSA's own copy since 5 Nov 2026)
import { LINK } from './link.mjs';

const CARD_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

// GSA Planning's look: Arial, their logo (one copy for both of their rooms). The warm look (Oren, 3 Nov 2026, #gsa: "too
// grey and boring"; Fable's directions): a warm off-white page, white cards, one accent (eucalyptus) with white text on
// it, its light tint for quotes and the asker's bubble; every text colour passes WCAG AA on white and on the page.
const GSA_LOOK = Object.freeze({
  by: 'GSA Planning',
  logo: 'assets/gsa-logo.svg',
  font: 'Arial, Helvetica, sans-serif',
  colors: Object.freeze({ bg: '#f7f5f0', panel: '#ffffff', accent: '#2f6b58', onaccent: '#ffffff', tint: '#e6f0ec', muted: '#5b5853', line: '#d9d4c9', ink: '#1c1b19' }),
});
const GSA_EXAMPLES = Object.freeze(['Which 2025 jobs were approved by Woollahra?', 'Which jobs breached FSR in Waverley?', 'Which of our jobs went to the Land and Environment Court?']);

export const ASK_ROOMS = Object.freeze({
  // GSA Planning (Oren, 28 Oct 2026, #gsa option 1): the 4 Nov face-to-face demo.
  'gsa-demo': Object.freeze({
    ...GSA_LOOK,
    title: 'Ask your project files',
    placeholder: 'Ask about your projects, for example: which 2025 jobs were approved by Woollahra?',
    // the 13 prepared answers (pages repo gsa-trial/answers, built by ~/god-work/gsa-demo-link/build.mjs; Oren's card 27 Oct)
    prepared: 'https://oren-and-elad.github.io/pages/gsa-trial/answers/',
    // the demo's own feedback (Oren, 3 Nov 2026, #gsa): a note on any part of the page lands in this room as his message
    feedback: 'gsa',
    // tappable questions while the room is empty (the live answers, Oren 3 Nov 2026)
    examples: GSA_EXAMPLES,
    // the presenter mode (Oren, 3 Nov 2026, #gsa: "like slide clicks"), one step on screen at a time; see presenterSteps
    presenter: Object.freeze([
      Object.freeze({ kind: 'inv', title: "What's in this demo" }),
      // Halina's questions word for word, from her email of 21 Oct 2026 (the same text as gsa-planning demo.py HALINA,
      // which gives them the checked answer): question 3 (the court one), then question 1 (the hard one)
      Object.freeze({ kind: 'ask', title: "Halina's question: the court appeals", q: 'Provide a list of DAs in 2025 that were appealed at the Land and Environment Court, and approved, and group them by use (eg dwelling house, residential flat building etc), and group them by LGA' }),
      Object.freeze({ kind: 'ask', title: "Halina's hard question", q: 'Provide a list of low and mid rise (LMR) DAs in the Woollahra Council local government area (LGA) that includes an affordable housing component and breached the LEP height and/or FSR, and have been approved either (i) by Council and (ii) by the Land and Environment Court (LEC) through a Section 34 agreement or hearing' }),
      Object.freeze({ kind: 'ask', title: 'Your question, George', q: '' }),
      Object.freeze({ kind: 'prep', title: 'Your office', keys: Object.freeze(['J1', 'F1', 'P1']), labels: Object.freeze({ F1: 'Fee proposal → job' }) }),
      Object.freeze({ kind: 'prep', title: 'Pricing', keys: Object.freeze(['PR']) }),
    ]),
  }),
  // The GSA chat (ADR-2611030930gc; Oren + Elad, 3 Nov 2026, #gsa): a free chat over the same 38 trial jobs, for George
  // and his people signed in by email (elad-oren-guests), until an end date or the off switch. Same sourced answers,
  // drawn as a conversation; follow-ups stay in one thread. No presenter; feedback is the directors' only.
  'gsa-chat': Object.freeze({
    ...GSA_LOOK,
    title: 'Chat with your project files',
    placeholder: 'Ask anything about your 2025 jobs, then ask a follow-up',
    chat: true,
    // the tabs and the prepared answers page come from the link this copy was built for (link.mjs, web/build.mjs): the
    // decision makers' link has Chat, Job board and Pricing; the team's has Chat and Job board, from its own page and code
    prepared: LINK.prepared,
    tabs: Object.freeze(LINK.tabs.map((t) => Object.freeze({ ...t }))),
    // each result one title line, up to three quoted lines and the source link; no table, filter or details (flatCard)
    flat: true,
    feedback: 'gsa',
  }),
  // The team's own chat room (Oren, 6 Nov 2026, #gsa): GSA's senior staff, their own guest list (a guest doc listing
  // 'gsa-team' only) and their own prepared-answers code on the room doc. Chat and Job board, never Pricing, no presenter.
  'gsa-team': Object.freeze({
    ...GSA_LOOK,
    title: 'Chat with your project files',
    placeholder: 'Ask anything about your 2025 jobs, then ask a follow-up',
    chat: true,
    prepared: LINK.name === 'team' ? LINK.prepared : null,
    tabs: Object.freeze(LINK.tabs.filter((t) => t.k !== 'PR').map((t) => Object.freeze({ ...t }))),
    flat: true,
  }),
});

// askRoomOf — the room id a location hash names, when the table has it; else null.
export function askRoomOf(hash) {
  const id = decodeURIComponent(String(hash || '').replace(/^#/, '')).trim();
  return Object.hasOwn(ASK_ROOMS, id) ? id : null;
}

// roomOfLocation — the room a page address names: its hash (`ask.html#gsa-chat`), or `?room=` (the email sign-in link
// comes back with Firebase's own query on it, so it carries the room as a query, never a hash). Else null.
export function roomOfLocation(hash, search) {
  if (LINK.only) return LINK.only;        // a link built for one room opens only that room, whatever the address says
  return askRoomOf(hash) || askRoomOf(new URLSearchParams(String(search || '')).get('room') || '') || 'gsa-chat'; // GSA's own page opens on the chat
}

// cssVars — the room's look as CSS custom properties (only hex colours and the font pass).
const HEX = /^#[0-9a-f]{6}$/i;
export function cssVars(room) {
  const out = {};
  for (const [k, v] of Object.entries(room?.colors || {})) if (HEX.test(v)) out[`--${k}`] = v;
  if (/^[A-Za-z ,'-]+$/.test(room?.font || '')) out['--font'] = room.font;
  return out;
}

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : 0));
// The relay writes this line (kernel2/answerer-logic.mjs replyOf; the console cannot import kernel2): change both together.
// console-ask-page.spec round-trips replyOf → splitAnswer and fails when they drift.
const SOURCES_HEAD = '\n\nSources (from your project files):\n';

// conversation — the room's messages as the page shows them, oldest first: each question a director asked, then the
// answer(s) to it. Rows are { id, from, text, kind, threadId, createdAt, failedAt }. An answer belongs to the latest
// question in its thread asked at or before it (a reply typed under a question from the main console is its own
// question). A question with no answer yet is `pending` (the page says it is searching). Only plain rows count: a row
// with a `kind` (a silence note, a card, a system line) is never shown — the page shows questions and answers only.
// In a chat room (`chat: true`, ADR-2611030930gc) a question is every plain row not from 'brain' or 'system' — a guest
// asks there too, and firestore.rules decides who may write — and each carries its conversation (`thread`: its threadId,
// else its own id) and the asker's `email`.
export function conversation(rows = [], directors = [], { chat = false } = {}) {
  const who = new Set(directors);
  // a guest's thumbs or note (`feedback`, ADR-2611030930gc) is not a question: the relay posts it to #gsa, never here
  const plain = (r) => r && !r.kind && !r.feedback && typeof r.text === 'string' && r.text.trim();
  const byTime = (a, b) => ms(a.createdAt) - ms(b.createdAt);
  const asker = chat ? (r) => typeof r.from === 'string' && r.from && r.from !== 'brain' && r.from !== 'system' : (r) => who.has(r.from);
  const qs = rows.filter((r) => plain(r) && asker(r)).sort(byTime);
  const answers = rows.filter((r) => plain(r) && r.from === 'brain').sort(byTime);
  const of = new Map(qs.map((q) => [q.id, []]));
  for (const a of answers) {
    const q = qs.filter((x) => (x.id === a.threadId || x.threadId === a.threadId) && ms(x.createdAt) <= ms(a.createdAt)).pop();
    if (q) of.get(q.id).push(a);
  }
  const out = [];
  for (const q of qs) {
    const mine = of.get(q.id);
    out.push({ kind: 'q', id: q.id, text: q.text.trim(), from: q.from, pending: !mine.length && !ms(q.failedAt),
      ...(chat ? { thread: q.threadId || q.id, email: String(q.fromEmail || '').toLowerCase() } : {}) });
    for (const a of mine) out.push({ kind: 'a', id: a.id, ...splitAnswer(a.text) });
  }
  return out;
}

// chatThreads — a chat room's conversation() items as its conversations, oldest first: { id, title (its first
// question), email (who started it), items (its questions and answers in order), at (when it was last added to, as the
// position of its newest item) }. `mine` (an email) keeps only the conversations that address started.
export function chatThreads(items = [], { mine = '' } = {}) {
  const by = new Map(); let cur = null;
  items.forEach((it, i) => {
    if (it.kind === 'q') {
      const id = it.thread || it.id;
      if (!by.has(id)) by.set(id, { id, title: it.text, email: it.email || '', items: [], at: i });
      cur = by.get(id);
    }
    if (cur) { cur.items.push(it); cur.at = i; }
  });
  const me = String(mine || '').toLowerCase();
  return [...by.values()].filter((t) => !me || t.email === me);
}

// The answerer's "Understood as: …" first line (kernel2/answerer-logic.mjs replyOf, a resolved follow-up): change both
// together; console-ask-page.spec round-trips it.
const UNDERSTOOD_HEAD = 'Understood as: ';

// splitAnswer — the relay's reply text (answerer-logic replyOf) back into { answer, sources: [{ head, where, quote }] };
// a source with a public link ("↗ <text> https://…", answerer-logic linkOf) also carries link: { text, url }. A reply
// opening with "Understood as: …" also carries `understood` (the question the answerer actually searched).
export function splitAnswer(text) {
  const raw = String(text || '');
  const u = raw.startsWith(UNDERSTOOD_HEAD) ? raw.slice(UNDERSTOOD_HEAD.length).split('\n')[0].trim() : '';
  const out = splitBody(u ? raw.slice(raw.indexOf('\n') < 0 ? raw.length : raw.indexOf('\n') + 1) : raw);
  return u ? { understood: u, ...out } : out;
}
function splitBody(t) {
  const i = t.indexOf(SOURCES_HEAD);
  if (i < 0) return { answer: t.trim(), sources: [] };
  const sources = [];
  for (const line of t.slice(i + SOURCES_HEAD.length).split('\n')) {
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m) { sources.push({ head: m[1].trim(), where: '', quote: '' }); continue; }
    const s = sources[sources.length - 1]; const x = line.trim();
    if (!s || !x) continue;
    const l = x.match(/^↗\s*(.*?)\s*(https:\/\/\S+)$/);
    if (l) s.link = { text: l[1] || 'Open link', url: l[2] };
    else if (/^“.*”$/.test(x)) s.quote = x.slice(1, -1); else s.where = x;
  }
  return { answer: t.slice(0, i).trim(), sources };
}

// ── who may ask in a chat room (ADR-2611030930gc) ──
// A guest is a doc `elad-oren-guests/{email, lowercased}` = { name, rooms: [room ids], until: Timestamp, off, addedBy,
// addedAt } (tools/guests.mjs writes it; firestore.rules lets the guest read only their own). guestAccess decides from
// that doc (null when it could not be read) and the time: 'ask' (the doc lists this room, is not off, and `until` is
// still ahead), 'closed' (it lists the room but is switched off or past its end), 'denied' (anything else).
const tsMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis()
  : (t && Number.isFinite(t.seconds) ? t.seconds * 1000 : (typeof t === 'number' ? t : (typeof t === 'string' ? Date.parse(t) : NaN))));
// `room` (the room doc, optional): its `guestsOff: true` is the room's one off switch, closed for every guest.
export function guestAccess(doc, roomId, nowMs, room = null) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.rooms) || !doc.rooms.includes(roomId)) return 'denied';
  if (typeof doc.name !== 'string' || !doc.name.trim()) return 'denied';
  const until = tsMs(doc.until);
  if (doc.off === true || room?.guestsOff === true || !Number.isFinite(until) || !(nowMs < until)) return 'closed';
  return 'ask';
}
// The relay says the same line to a question asked after the end (kernel2/answerer-logic.mjs CLOSED_LINE).
// linkOpen — is this private link still open at `now` (ms)? Each link ends on its own date (LINK.until, an ISO date-time
// with its offset; 14 days from 6 Nov 2026, Halina: "a couple of weeks"). Fails closed: a date without its offset or one
// that does not parse closes the link; no date at all (the source copy) leaves it open.
export function linkOpen(link, now) {
  const u = link?.until;
  if (u == null) return true;
  if (typeof u !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(u)) return false;
  const t = Date.parse(u);
  return Number.isFinite(t) && now < t;
}
export const LINK_CLOSED_LINE = 'This link has closed. Thank you for trying it.';
export const CLOSED_LINE = 'This trial chat has closed. Thank you for trying it.';
export const DENIED_LINE = 'This account cannot use this chat.';
// wrongLinkLine — a guest signed in on the other trial link (Elliott, 9 Nov 2026: a gsa-N login on the team link only
// read "cannot use this chat"): name the link their username belongs to. '' when the doc lists no other open room.
export function wrongLinkLine(guestDoc, roomId) {
  const rooms = Array.isArray(guestDoc?.rooms) ? guestDoc.rooms.filter((r) => typeof r === 'string' && r !== roomId) : [];
  const other = rooms.find((r) => /^gsa-(chat|team)$/.test(r));
  if (!other) return '';
  return `This username belongs to the other link: ${other === 'gsa-team' ? 'the team link' : 'the link with Pricing'}, https://oren-and-elad.github.io/pages/${other}/ . Please sign in there.`;
}

// askMessage — the one message a question becomes (index.html sendMsg's shape, with the verified identity
// firestore.rules binds): a guest's also says `guest: true`, and a follow-up carries its conversation's `threadId`.
// `createdAt` (serverTimestamp) is added by the page. Nothing else is ever written.
export function askMessage({ name, uid, email, text, threadId, guest = false }) {
  return { type: 'text', from: name, text, images: [], relayed: false, fromUid: uid, fromEmail: email,
    ...(guest ? { guest: true } : {}), ...(typeof threadId === 'string' && threadId ? { threadId } : {}) };
}

// feedbackMessage — a guest's thumbs up / down on one answer (`about`: the answer's id) or a general note, as the one
// message firestore.rules accepts (guestCreateOk's feedback shape): `feedback` 'up' | 'down' | 'note', the note as
// `text` (a thumb with no note carries the thumb itself, so the text is never empty), cut to 1000. The relay posts it to
// the room's feedback room naming the login and the question. null when there is nothing to send (a note with no words).
export const FEEDBACK_MAX = 1000;
const THUMB = Object.freeze({ up: '👍', down: '👎' });
export function feedbackMessage({ name, uid, email, rating, note = '', about = '', realName = '' }) {
  if (!['up', 'down', 'note'].includes(rating)) return null;
  const n = String(note ?? '').trim().slice(0, FEEDBACK_MAX);
  if (!n && rating === 'note') return null;
  const id = typeof about === 'string' && /^[A-Za-z0-9]{1,64}$/.test(about) ? about : '';
  const who = cleanName(realName);
  const body = n || THUMB[rating];
  return { type: 'text', from: name, text: who ? `${body.slice(0, FEEDBACK_MAX - who.length - 3)} — ${who}` : body, images: [], relayed: false, fromUid: uid, fromEmail: email,
    guest: true, feedback: rating, ...(id && rating !== 'note' ? { about: id } : {}) };
}

// mergeRows — a guest's two listeners (what they asked: fromUid; what answers them: askerUid — the only messages
// firestore.rules lets them read) as one list, each message once.
export function mergeRows(...lists) {
  const by = new Map();
  for (const l of lists) for (const r of l || []) if (r && r.id) by.set(r.id, r);
  return [...by.values()];
}

// preparedBlobOf — the encrypted blob a prepared-answers page carries (`const B={salt,iv,iter,ct}`), or null.
export function preparedBlobOf(html) {
  const m = String(html || '').match(/const B=(\{[^<]*?\});/);
  if (!m) return null;
  try {
    const b = JSON.parse(m[1]);
    return ['salt', 'iv', 'ct'].every((k) => typeof b[k] === 'string') && Number.isInteger(b.iter) && b.iter >= 100000 ? b : null;
  } catch { return null; }
}

// preparedTabs — the decrypted page's answers in its own order, each with the label its preset row gives it.
// A page may group its answers (`groups: [{ title, keys, lead }]`, Oren 2 Nov 2026: "Halina's three questions" first and
// set apart): tabs then follow the groups' order, each carrying its group's title and `lead`; an answer no group names
// comes last, in the page's order, with no group.
export function preparedTabs(d) {
  const label = {};
  for (const m of String(d?.body || '').matchAll(/<a [^>]*data-k="([A-Z0-9]+)"[^>]*>([^<]*)<\/a>/g)) label[m[1]] = m[2].trim();
  const has = (k) => typeof k === 'string' && typeof d?.bodies?.[k] === 'string';
  const out = []; const seen = new Set();
  for (const g of Array.isArray(d?.groups) ? d.groups : []) {
    const title = typeof g?.title === 'string' ? g.title.trim().slice(0, 60) : '';
    for (const k of Array.isArray(g?.keys) ? g.keys : []) {
      if (!has(k) || seen.has(k)) continue;
      seen.add(k); out.push({ k, label: label[k] || k, group: title, lead: g.lead === true });
    }
  }
  for (const k of Array.isArray(d?.order) ? d.order : []) if (has(k) && !seen.has(k)) { seen.add(k); out.push({ k, label: label[k] || k }); }
  return out;
}

// preparedScope — the page's one plain line on what its answers rest on (how many jobs, which files, what is not in
// them), shown as text above every tab, the live question too; '' when the page has none.
// The demo's steps (Oren, 2 Nov 2026): the order the menu shows — the lead group's tabs, then "Ask a question", then
// the rest — numbered from 1, so the presenter knows which step is on screen. With no lead group "Ask a question" is
// step 1 (Oren, 3 Nov 2026: Halina's prepared answers are out, the demo opens on the live question). Returns the keys.
export function stepOrder(list) {
  const tabs = (list || []).filter((x) => x?.k && x.k !== 'live');
  let n = 0; while (n < tabs.length && tabs[0].lead === true && (tabs[n].group ?? '') === (tabs[0].group ?? '')) n += 1;
  const live = (list || []).some((x) => x?.k === 'live') ? ['live'] : [];
  return [...tabs.slice(0, n).map((x) => x.k), ...live, ...tabs.slice(n).map((x) => x.k)];
}

export function preparedScope(d) {
  return typeof d?.scope === 'string' ? d.scope.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
}

// preparedDoc — one prepared answer as the locked page it is shown in: an <iframe sandbox=PREPARED_SANDBOX> (no script,
// an opaque origin with no access to the sign-in; a source link opens in a new tab) plus the console's card CSP, so
// nothing loads from outside. Its own styles stay inside the frame.
export const PREPARED_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';
export function preparedDoc(d, k) {
  const css = String(d?.css || '').replace(/<\/style/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">`
    + `<base target="_blank"><style>${css}body{background:transparent}</style></head><body><main>${d?.bodies?.[k] ?? ''}</main></body></html>`;
}

// feedbackText — a director's note on one part of the page (Oren, 3 Nov 2026, #gsa: right-click, or the Feedback button
// on a phone), as the message it becomes in the room's feedback room: the note, then what it is about (the step on
// screen, the part's own text, the question an answer belongs to), each cut short. '' when there is no note.
const cut = (x, n) => { const t = String(x ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export function feedbackText({ note, step, on, question, page } = {}) {
  const n = String(note ?? '').trim().slice(0, 2000);
  if (!n) return '';
  return [`🖍 Demo feedback${page ? ` (${cut(page, 80)})` : ''}:`, n, '',
    ...(step ? [`Step: ${cut(step, 80)}`] : []),
    ...(question ? [`Question: “${cut(question, 300)}”`] : []),
    ...(on ? [`On: “${cut(on, 300)}”`] : []),
    '→ Boss: change the demo, then post a screenshot in #gsa.'].join('\n');
}

// ── an answer as the page shows it (Oren, 3 Nov 2026, #gsa: mockup v2 with the declutter rules) ──
// The first screen of an answer is its headline ("Found 3 jobs"), its one answer line and the results as closed cards;
// everything else opens on a click. A closed card is two lines: the council and address with the key figure in bold,
// then the status tag. The comparison table is offered only with STRIP_MIN results or more, the filters only with more
// than FILTER_AFTER. The answerer's source line (kernel2/answerer-logic.mjs sourceLine, from gsa-planning demo.py card:
// "Council · outcome · breach — address · use · FSR … · height … · decided … · application … · GSA planner: … · note") is read back here;
// a line in any other shape is still shown, as a plain card.
export const STRIP_MIN = 4;
export const FILTER_AFTER = 5;
// The answerer's coverage line ("Searched all 38 jobs · 3 matched · 2 close (shown below) · the other 33 …", Oren 3 Nov
// 2026: every job was checked) is its own line in the answer; it is lifted out and shown under the headline.
const COVERAGE = /^Searched all \d+ jobs\b.*$/m;
export function answerView({ answer, sources } = {}) {
  const all = String(answer ?? '').trim();
  const coverage = all.match(COVERAGE)?.[0].trim() || '';
  const t = all.replace(COVERAGE, '').trim();
  const m = t.match(/^((?:Found \d+|No )[^.]*)\.\s*([\s\S]*)$/);
  const cards = (Array.isArray(sources) ? sources : []).map(resultCard);
  // the table and the filters count jobs only: a quoted passage ("The Clause 4.6 grounds, as argued") is not a result
  const jobs = cards.filter((c) => c.council).length;
  return { headline: m ? m[1] : '', lead: m ? m[2].trim() : t, coverage, cards,
    strip: jobs >= STRIP_MIN, filter: jobs > FILTER_AFTER };
}

// ── while answering (Oren, 3 Nov 2026, #gsa): a calm scan across file icons with "Reading 38 jobs… 234 documents", held
// for at least SCAN_MIN_MS, then the cards fade in. The numbers are the trust line's own (inventoryOf), so the page
// never shows two document counts. scanLeft says how long a question first seen waiting at
// `seenAt` still shows the scan at `now` (0: show the answer). A question never seen waiting (a reload) never waits.
export const SCAN_MIN_MS = 1600;
export function scanLeft(seenAt, now) {
  return Number.isFinite(seenAt) ? Math.max(0, SCAN_MIN_MS - (now - seenAt)) : 0;
}

// resultCard — one source as a card: { council, place, key, status, tone, facts: [[label, value]], note, where, quote }
// and its public link ({ text, url }, a Caselaw judgment) when it has one.
// tone is ok (approved), no (refused), wait (pending) or unk (not stated): the only colours on the page besides the accent.
const FSR = (s) => s.replace(/\bfsr\b/gi, 'FSR');
export function toneOf(status) {
  const s = String(status || '').toLowerCase();
  if (/refus|dismiss|reject/.test(s)) return 'no';
  if (/not in the documents|not stated|unknown/.test(s) || !s) return 'unk';
  if (/approv|upheld|grant|consent/.test(s)) return 'ok';
  return 'wait';
}
export function resultCard(s = {}) {
  const head = String(s.head ?? '');
  const cut = head.indexOf(' — ');
  const title = (cut < 0 ? head : head.slice(0, cut)).trim();
  const meta = cut < 0 ? [] : head.slice(cut + 3).split(' · ').map((x) => x.trim()).filter(Boolean);
  const parts = title.split(' · ').map((x) => x.trim());
  const base = { where: String(s.where ?? ''), quote: String(s.quote ?? ''),
    ...(/^https:\/\//.test(s.link?.url || '') ? { link: { text: String(s.link.text || 'Open link'), url: s.link.url } } : {}) };
  // a line before the cards ("Job 25829 · DA37/2026/1 — lga: …", until 3 Nov 2026) is a plain card, not a council and a tag
  if (parts.length < 2 || !meta.length || /^Job /.test(parts[0])) return { ...base, council: '', place: title, key: '', status: '', tone: '', facts: [], note: meta.join(' · ') };
  const facts = []; const note = []; let use = '';
  for (const [i, x] of meta.slice(1).entries()) {
    if (note.length || /^(Close, but|An older application)/.test(x)) { note.push(x); continue; }
    const g = x.match(/^GSA planner:\s*(.+)$/);   // who on GSA's team handled the job, or "not in the files" (Oren, 3 Nov 2026, #gsa)
    if (g) { facts.push(['GSA planner', g[1]]); continue; }
    const f = x.match(/^(FSR|height|application)\s+(.*)$/i);
    if (f) { facts.push([f[1][0].toUpperCase() + f[1].slice(1), f[2]]); continue; }
    if (/^decided /.test(x)) { facts.push(['Decided', x.slice(8)]); continue; }
    if (/^decision date/.test(x)) { facts.push(['Decided', 'not stated']); continue; }
    if (!use && i === 0) { use = x; continue; }
    facts.push(['', x]);
  }
  if (use) facts.unshift(['Use', use]);
  const status = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
  return { ...base, council: parts[0].replace(/\s+Council$/i, ''), place: placeOf(meta[0]), key: FSR(parts.slice(2).join(' · ')),
    status, tone: toneOf(status), facts, note: note.join(' · ') };
}

// chatTabs — a chat room's tabs in its own order (Oren + Elad, 5 Nov 2026, #gsa: 1. Chat, 2. Job board, 3. Pricing),
// each { k, label } numbered from 1; `k` is 'chat' or a prepared answer's key. Before the prepared page is open (`d`
// null) every tab shows, and a prepared one asks for the access code; once open, a key the page does not carry is left out.
export function chatTabs(room, d = null) {
  const list = (Array.isArray(room?.tabs) ? room.tabs : []).filter((t) => typeof t?.k === 'string' && t.k
    && (t.k === 'chat' || !d || typeof d?.bodies?.[t.k] === 'string'));
  return list.map((t, i) => ({ k: t.k, label: `${i + 1}. ${String(t.label || t.k)}` }));
}

// flatCard — one result as the chat draws it (Oren + Elad, 5 Nov 2026, #gsa): ONE title line (council · address ·
// decision, or the plain heading), the quote (the page clamps it to three lines; a card with no quote shows its note),
// and the source link — or, with no public link, the file and page as plain text. Nothing else: no facts, tag or toggle.
export const QUOTE_LINES = 3;
export function flatCard(c = {}) {
  const title = [c.council, c.place, c.status].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ');
  return { title, quote: String(c.quote || c.note || '').trim(),
    ...(c.link ? { link: c.link } : {}), where: c.link ? '' : String(c.where ?? '').trim() };
}

// placeOf — an address short enough to read from across a room: no state and postcode, the suburb said once
// ("41 Spencer St, Rose Bay NSW 2029, Rose Bay" → "41 Spencer St, Rose Bay").
export function placeOf(a) {
  const t = String(a ?? '').replace(/\s+NSW\s+\d{4}\b/gi, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*),\s*([^,]+)$/);
  return m && m[1].toLowerCase().includes(m[2].toLowerCase()) ? m[1] : t;
}

// filterChips — the filter bar's choices for one answer: each council and each decision, with how many cards have it.
// The decision chips are the four tones (Approved, Refused, Pending, Not stated), not each body's own wording.
export const TONE_LABEL = Object.freeze({ ok: 'Approved', no: 'Refused', wait: 'Pending', unk: 'Not stated' });
export function filterChips(cards = []) {
  const count = (f) => [...cards.reduce((m, c) => (f(c) ? m.set(f(c), (m.get(f(c)) || 0) + 1) : m), new Map())];
  return { council: count((c) => c.council), status: count((c) => TONE_LABEL[c.tone] || '') };
}

// ── what's in this demo (Oren, 3 Nov 2026, #gsa: GSA must trust that the search covers everything we hold) ──
// The room's record carries `inventory` ({ jobs: [{ job, address, council, docs, types: [[type, n]] }], documents }, from
// ~/god-work/gsa-demo-inventory/build.py over the trial database). Only directors read the room's record, as they read
// its answers. inventoryOf keeps the well-formed jobs or returns null; the trust line names the totals and opens the table.
const str = (v, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function inventoryOf(d) {
  const list = Array.isArray(d?.inventory?.jobs) ? d.inventory.jobs : [];
  const jobs = list.filter((j) => j && str(j.job)).map((j) => ({ job: str(j.job, 20), address: placeOf(str(j.address)), council: str(j.council, 60).replace(/\s+Council$/i, ''),
    docs: Number.isInteger(j.docs) && j.docs >= 0 ? j.docs : 0,
    types: (Array.isArray(j.types) ? j.types : []).filter((x) => Array.isArray(x) && str(x[0]) && Number.isInteger(x[1])).map(([t, n]) => [str(t, 40), n]) }));
  return jobs.length ? { jobs, documents: jobs.reduce((n, j) => n + j.docs, 0) } : null;
}
export function trustLine(inv) {
  return inv ? `From ${inv.jobs.length} GSA jobs · ${inv.documents} documents` : '';
}
export const typesText = (j) => j.types.map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(' · ');
// jobsView — the table's rows: those whose job no., address, council or document types contain the search words (every
// word, any case), sorted by one column (`job`, `address`, `council`, `docs`, `types`), then by job no.
export const JOB_COLUMNS = Object.freeze([['job', 'Job no.'], ['address', 'Address'], ['council', 'Council'], ['docs', 'Documents'], ['types', 'Document types']]);
export function jobsView(jobs = [], { sort = 'job', dir = 1, q = '' } = {}) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const text = (j) => `${j.job} ${j.address} ${j.council} ${typesText(j)}`.toLowerCase();
  const val = (j) => (sort === 'docs' ? j.docs : sort === 'types' ? typesText(j) : String(j[sort] ?? ''));
  const cmp = (a, b) => (typeof a === 'number' ? a - b : a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
  return jobs.filter((j) => words.every((w) => text(j).includes(w)))
    .sort((a, b) => (cmp(val(a), val(b)) * (dir < 0 ? -1 : 1)) || cmp(a.job, b.job));
}

// presenterSteps — the presenter mode's screens in order (Oren, 3 Nov 2026, #gsa): one per click of Next. A room's
// `presenter` step is one screen, except a prepared step, which is one screen per answer it names that the decrypted page
// has (`labels`: key → label, from preparedTabs; the step's own `labels` win), all under the same step number. A prepared step with none of its
// answers is left out, and the steps are numbered as shown. Each screen is { n, of, kind, title, q?, k? }.
export function presenterSteps(room, labels = {}) {
  const steps = (Array.isArray(room?.presenter) ? room.presenter : []).map((s) => {
    if (s?.kind === 'prep') {
      const ks = (Array.isArray(s.keys) ? s.keys : []).filter((k) => Object.hasOwn(labels, k));
      return ks.map((k) => ({ kind: 'prep', k, title: ks.length > 1 ? `${s.title} · ${s.labels?.[k] || labels[k]}` : s.title }));
    }
    if (s?.kind === 'ask') return [{ kind: 'ask', title: String(s.title || ''), q: String(s.q || '') }];
    if (s?.kind === 'inv') return [{ kind: 'inv', title: String(s.title || '') }];
    return [];
  }).filter((x) => x.length);
  return steps.flatMap((x, i) => x.map((y) => ({ n: i + 1, of: steps.length, ...y })));
}

// presenterTurn — of the room's conversation() items, the one question asked on this screen and its answers (the
// presenter mode hides every earlier answer); [] before it is asked.
export function presenterTurn(items = [], qid = '') {
  const i = qid ? items.findIndex((x) => x.kind === 'q' && x.id === qid) : -1;
  if (i < 0) return [];
  const j = items.findIndex((x, n) => n > i && x.kind === 'q');
  return items.slice(i, j < 0 ? undefined : j);
}

// A guest's own name (Oren, 6 Nov 2026, #gsa): on their FIRST sign-in, in either link, one required field "Your name",
// asked once per username. Kept on their own guest doc as `displayName` (the relay names it on their feedback and
// usage), and on this device as a fallback. No IP address is ever read or kept.
export const NAME_LABEL = 'Your name';
export const NAME_HINT = 'So we know whose questions and feedback these are.';
export const NAME_MAX = 60;
export function cleanName(s) {
  const n = String(s ?? '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= NAME_MAX ? n : '';
}
export const nameKey = (email) => `gsa-name:${String(email ?? '').toLowerCase()}`;
// the name already given for this username ('' = ask for it): the guest doc's first, then this device's
export function savedName(guestDoc, stored = '') {
  return cleanName(guestDoc?.displayName) || cleanName(stored);
}

// ── the job board, drawn by this page (6 Nov 2026): the data is the J1 answer's own `board-data` (gsa-planning
// demo.board_data), inside the encrypted prepared page; the page shows it as columns by stage, a planner chip row to
// filter by, drag a card onto a planner to assign it (kept in this browser only), and the completed jobs by year.
export const BOARD_STAGES = Object.freeze(['Pre-DA', 'DA', 'Court', 'Completed', 'not in the files']);
export const BOARD_KEY = 'gsa:board-assign';
const BOARD_FIELDS = ['job', 'where', 'stage', 'year', 'reviewer', 'planner', 'colour', 'hint'];
// a fee or an amount never reaches the board (the team link carries no pricing anywhere): every field is cut to the
// known list, and any text that looks like money is blanked
export const MONEY = /\$|A\$|\baud\b|\bfees?\b|\bpric|\b\d{1,3}(,\d{3})+(\.\d+)?\b/i;
export function boardOf(body) {
  const m = String(body || '').match(/<script type="application\/json" class="board-data">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let d; try { d = JSON.parse(m[1]); } catch { return null; }
  if (!Array.isArray(d?.cards)) return null;
  return d.cards.filter((c) => c && typeof c.job === 'string' && c.job).map((c) => Object.fromEntries(BOARD_FIELDS.map((k) => {
    const v = String(c[k] ?? '').slice(0, 200);
    return [k, k === 'colour' ? (/^#[0-9a-f]{3,8}$/i.test(v) ? v : '') : (MONEY.test(v) ? '' : v)];
  })));
}

// assignments kept in this browser: { job: planner }; anything else in storage is ignored
export function readAssign(raw) {
  let o; try { o = JSON.parse(raw || '{}'); } catch { return {}; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
  return Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === 'string' && v && /^[\w ./-]{1,40}$/.test(k)).map(([k, v]) => [k, v.slice(0, 40)]));
}
export function assignJob(map, job, planner, original = '') {
  const next = { ...map };
  if (!planner || planner === original) delete next[job]; else next[job] = planner;
  return next;
}

// boardView — the board as drawn: planner chips (each with its job count, after assignments), the columns by stage for
// the chosen planner ('' = everyone), and the Completed column grouped by year, newest first ('Year not in the files' last).
export const NO_YEAR = 'Year not in the files';
export function boardView(cards = [], { planner = '', assign = {} } = {}) {
  const colourOf = {};
  for (const c of cards) if (c.planner && c.colour) colourOf[c.planner] = c.colour;
  const all = cards.map((c) => {
    const p = assign[c.job] || c.planner;
    return { ...c, planner: p, colour: colourOf[p] || '', moved: Boolean(assign[c.job] && assign[c.job] !== c.planner) };
  });
  const count = {};
  for (const c of all) if (c.planner) count[c.planner] = (count[c.planner] || 0) + 1;
  const planners = Object.keys(count).sort((a, b) => count[b] - count[a] || a.localeCompare(b))
    .map((p) => ({ planner: p, colour: colourOf[p] || '', n: count[p], on: p === planner }));
  const shown = planner ? all.filter((c) => c.planner === planner) : all;
  const byJob = (a, b) => a.job.localeCompare(b.job, 'en', { numeric: true });
  const columns = BOARD_STAGES.map((stage) => {
    const list = shown.filter((c) => (BOARD_STAGES.includes(c.stage) ? c.stage : 'not in the files') === stage).sort(byJob);
    const col = { stage, n: list.length, cards: list };
    if (stage === 'Completed') {
      const years = [...new Set(list.map((c) => c.year || NO_YEAR))].sort((a, b) => (a === NO_YEAR) - (b === NO_YEAR) || b.localeCompare(a));
      col.years = years.map((y) => ({ year: y, cards: list.filter((c) => (c.year || NO_YEAR) === y) }));
    }
    return col;
  }).filter((c) => c.n || c.stage !== 'not in the files');
  return { planners, planner, columns, total: shown.length, unassigned: shown.filter((c) => !c.planner).length };
}

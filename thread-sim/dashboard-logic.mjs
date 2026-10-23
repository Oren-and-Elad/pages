// dashboard-logic.mjs — the console half of the directors' dashboard (Oren, 20 Oct 2026). Pure, zero I/O: the grid
// arithmetic for move / resize / add / delete / edit / run now. The card shape and its bounds are the kernel's
// (kernel2/dashboard-logic.mjs normalizeCard): this file only ever hands back cards inside the same bounds.
export const GRID_COLS = 12;
export const ROW_PX = 90; // one grid row's height on screen
export const DEFAULT_TIME = '07:00';
export const MAX_CARDS = 24; // = kernel2/dashboard-logic.mjs MAX_CARDS (pinned by console-dashboard-logic.spec)

// The two cards shown until the first save; the ONE copy (kernel2/dashboard-logic.mjs re-exports it).
export const SEED_CARDS = Object.freeze([
  { id: 'tokens-month', title: 'Tokens this month', prompt: 'How many tokens and how many dollars did we spend since the start of this month (Sydney time)? One line per account, then the total.', time: DEFAULT_TIME, x: 0, y: 0, w: 4, h: 2, lastRunAt: 0, runRequestedAt: 0, result: '' },
  { id: 'top3-today', title: 'Top 3 today', prompt: 'What are the 3 most important things Oren and Elad should do today? One short line each, with why.', time: DEFAULT_TIME, x: 4, y: 0, w: 8, h: 2, lastRunAt: 0, runRequestedAt: 0, result: '' },
]);

// The cards a doc holds, or the seed when it holds none (a fresh copy: callers map over it).
export const cardsOf = (data) => (Array.isArray(data?.cards) ? data.cards : SEED_CARDS.map((c) => ({ ...c })));

// A console write: `op` (one of the pure ops below) applied to the FRESH cards read inside a transaction. The ops touch
// only what the console owns (title, prompt, time, x, y, w, h, runRequestedAt, add, delete), so a result or lastRunAt the
// relay wrote, or another director's change to another card, is never carried back stale.
export const applyOp = (data, op) => op(cardsOf(data));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(+v || 0)));

// A pixel drag → grid delta. `colPx` is the grid's width / GRID_COLS at drag start.
export function gridDelta(dxPx, dyPx, colPx, rowPx = ROW_PX) {
  return { dx: Math.round(dxPx / Math.max(1, colPx)), dy: Math.round(dyPx / Math.max(1, rowPx)) };
}

export function moveCard(cards, id, dx, dy) {
  return cards.map((c) => (c.id === id ? { ...c, x: clamp(c.x + dx, 0, GRID_COLS - c.w), y: clamp(c.y + dy, 0, 999) } : c));
}

export function resizeCard(cards, id, dw, dh) {
  return cards.map((c) => (c.id === id ? { ...c, w: clamp(c.w + dw, 1, GRID_COLS - c.x), h: clamp(c.h + dh, 1, 12) } : c));
}

export function editCard(cards, id, { title, prompt, time } = {}) {
  const ok = (t) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  return cards.map((c) => (c.id === id ? { ...c, ...(title != null ? { title: String(title).slice(0, 120) } : {}), ...(prompt != null ? { prompt: String(prompt).slice(0, 4000) } : {}), ...(ok(time) ? { time } : {}) } : c));
}

// A new card goes under the lowest one, full default size; its id is a short random-free stamp from `nowMs`.
export function addCard(cards, nowMs) {
  if (cards.length >= MAX_CARDS) return cards;
  const y = cards.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  return [...cards, { id: `c${nowMs.toString(36)}`, title: 'New card', prompt: '', time: DEFAULT_TIME, x: 0, y, w: 4, h: 2, lastRunAt: 0, runRequestedAt: 0, result: '' }];
}

export const deleteCard = (cards, id) => cards.filter((c) => c.id !== id);

// "Run now": the relay runs it on its next minute beat (runRequestedAt newer than lastRunAt). Opening never runs.
export const requestRun = (cards, id, nowMs) => cards.map((c) => (c.id === id ? { ...c, runRequestedAt: nowMs } : c));

// What the card's footer says: running (asked, not answered yet), or when it last ran and when it runs next.
export function cardStatus(c, nowMs) {
  if (c.runRequestedAt && c.runRequestedAt > (c.lastRunAt || 0)) return 'Running… (within a minute or two)';
  const last = c.lastRunAt ? `Ran ${new Date(c.lastRunAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not run yet';
  return `${last} · daily at ${c.time || DEFAULT_TIME}`;
}

// A card's answer is HTML when it opens with a tag (kernel2/dashboard-logic.mjs DASHBOARD_SYSTEM asks for that, Oren
// 21 Oct); anything else, and every answer written before, is shown as text.
export const isHtmlResult = (r) => /^\s*<[a-z!]/i.test(String(r || ''));

// Links inside a card (Oren, 22 Oct 2026: "each task clickable, to jump in and start handling it"). A card may link
// only to the console itself, opened in the whole tab (target="_top"): CONSOLE_URL + `index.html#<room>[/<thread root>]`
// (logic.js parseDeepHash). Every other link, and every way of running or loading something, is stripped by
// sanitizeCardHtml — the ONE copy: the relay runs it on the answer it writes (kernel2 resultText) and the console runs
// it again before it shows any answer (cardDoc), so an answer written by anything else is held to the same rule.
export const CONSOLE_URL = 'https://cleo2.pages.dev/elad-and-oren/';
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export function consoleLink(roomId, threadRoot = null) {
  if (!SAFE_ID.test(String(roomId || ''))) return null;
  return `${CONSOLE_URL}index.html#${roomId}${threadRoot && SAFE_ID.test(String(threadRoot)) ? `/${threadRoot}` : ''}`;
}
export const isConsoleHref = (v) => /^https:\/\/cleo2\.pages\.dev\/elad-and-oren\/[A-Za-z0-9._~\/?#=&%+-]*$/.test(String(v)) && !String(v).includes('..');
const DROP_TAGS = /^(script|iframe|frame|frameset|object|embed|applet|base|meta|link|form|input|button|select|textarea|portal|animate|animatemotion|animatetransform|set|foreignobject)$/i;
const URL_ATTRS = /^(href|src|srcset|srcdoc|action|formaction|background|poster|ping|data|codebase|cite|longdesc|manifest|lowsrc|dynsrc|http-equiv|target|rel)$/i;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const escAttr = (v) => String(v).replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z]+);)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// sanitizeCardHtml — every tag is rebuilt from what is allowed: script/frames/forms/base/meta (and SVG's animate/set,
// which can write an href) are dropped; every on* attribute and every URL-carrying attribute is dropped, except an
// <a href> to the console, which is kept and opens in the whole tab. Comments and doctypes go; a "<" that does not
// open a well-formed tag becomes text (an unclosed tag at the end cannot swallow what the page adds after it).
// No DOM: the relay runs this in node.
export function sanitizeCardHtml(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '')
    .replace(/<!--[\s\S]*?(-->|$)|<![^>]*>/g, '')
    .replace(/<(\/?)([a-zA-Z][\w:-]*)([^<>]*)>|<(?=[a-zA-Z/!?])/g, (m, close, tag, rest) => {
      if (!tag) return '&lt;';
      if (DROP_TAGS.test(tag)) return '';
      if (close) return `</${tag}>`;
      const keep = [];
      let href = null;
      for (const [, name, a, b, c] of String(rest).matchAll(ATTR)) {
        const n = name.toLowerCase(); const v = a ?? b ?? c;
        if (n.startsWith('on')) continue;
        if (n === 'href' && tag.toLowerCase() === 'a' && isConsoleHref(v ?? '')) { href = v; continue; }
        if (URL_ATTRS.test(n) || n.includes(':')) continue;
        keep.push(v == null ? name : `${name}="${escAttr(v)}"`);
      }
      if (href) keep.push(`href="${escAttr(href)}"`, 'target="_top"');
      return `<${tag}${keep.length ? ` ${keep.join(' ')}` : ''}${/\/\s*$/.test(rest) ? ' /' : ''}>`; // an SVG <path/> stays closed
    });
}

// The locked page an HTML answer is shown in: an <iframe sandbox="allow-top-navigation-by-user-activation"> (no
// script, no forms, no popups, an opaque origin with no access to the console's sign-in; a tap on a console link may
// move the whole tab, and nothing else may) plus this CSP, so nothing loads from outside. The answer is sanitised
// first (sanitizeCardHtml). The base style matches the console's card, so a bare answer already reads right.
export const CARD_SANDBOX = 'allow-top-navigation-by-user-activation';
export const CARD_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
export function cardDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CARD_CSP}">`
    + '<style>html,body{margin:0;background:transparent;color:#f4ecd6;font:15px/1.45 -apple-system,system-ui,"Segoe UI",sans-serif}'
    + 'body{padding:10px 14px;unicode-bidi:plaintext;text-align:start}summary{cursor:pointer;color:#e8a25a}'
    + 'table{border-collapse:collapse;width:100%}td,th{padding:3px 6px;text-align:start}a{color:#e8a25a}</style></head>'
    + `<body dir="auto">${sanitizeCardHtml(html)}</body></html>`;
}

// ── Tiles (Oren, 23 Oct 2026: "less text, more visual … in every card I scan one small visual thing"; and "everything
// clickable, to dive in and reach the thread"). The page shows each card as ONE tile: an icon, one value, a colour and
// a few words. A tap opens the card's full answer, whose links go into the threads. The model writes the tile as the
// first line of its answer (kernel2 DASHBOARD_SYSTEM); the relay takes it off with splitTile and stores it on the card
// as `tile`, bounded by normalizeTile. ok = nothing for a director, warn = worth a look, bad = a problem today.
export const TILE_STATUS = Object.freeze(['ok', 'warn', 'bad', 'none']);
const chars = (s, n) => [...String(s ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
export function normalizeTile(t) {
  if (!t || typeof t !== 'object') return null;
  const value = chars(t.value, 8);
  if (!value) return null;
  return { status: TILE_STATUS.includes(t.status) ? t.status : 'none', value, label: chars(t.label, 32), icon: chars(t.icon, 4) };
}
// splitTile — `TILE: <status> | <value> | <label> | <icon>` off the start of an answer → { tile (or null), rest }.
export function splitTile(text) {
  const s = String(text ?? '').replace(/^\s+/, '');
  const m = s.match(/^TILE:[ \t]*([^\n]*)\n?/i);
  if (!m) return { tile: null, rest: s };
  const [status = '', value, label, icon] = m[1].split('|').map((x) => x.trim());
  return { tile: normalizeTile({ status: status.toLowerCase(), value, label, icon }), rest: s.slice(m[0].length) };
}
// tileOf — what a card's tile shows: running, failed, its stored tile, or a grey "—" (no answer yet, or an answer
// written before tiles). The label falls back to the card's title.
export function tileOf(c) {
  if (c.runRequestedAt && c.runRequestedAt > (c.lastRunAt || 0)) return { status: 'none', value: '…', label: c.title, icon: '' };
  if (/^Not run:/.test(String(c.result || ''))) return { status: 'bad', value: '!', label: c.title, icon: '⚠️' };
  const t = normalizeTile(c.tile);
  return t ? { ...t, label: t.label || c.title } : { status: 'none', value: '—', label: c.title, icon: '' };
}
// boardSummary — the one line on top: how many tiles are red and orange, and when the cards last ran.
export function boardSummary(cards) {
  const tiles = cards.map(tileOf);
  return { bad: tiles.filter((t) => t.status === 'bad').length, warn: tiles.filter((t) => t.status === 'warn').length, checkedAt: cards.reduce((m, c) => Math.max(m, +c.lastRunAt || 0), 0) };
}
// The cards in the grid's order: top to bottom, then by column.
export const tileOrder = (cards) => [...cards].sort((a, b) => a.y - b.y || a.x - b.x);

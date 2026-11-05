// ask-view.js — the live question's answers on the answerer room's page (ask.html; Oren, 3 Nov 2026, #gsa: mockup v2
// with the declutter rules). DOM only, no Firestore, so it can be drawn from saved answers too. The newest question and
// its answer fill the screen: the headline, the one answer line and the results as closed cards; a card opens on a click
// (its facts, the note, the quote, the file and page as plain text, and a public link such as a Caselaw judgment). A comparison table and the filters are behind one button
// each, offered only when there are enough results (ask-logic.mjs STRIP_MIN, FILTER_AFTER). Earlier questions fold
// into one line. A chat room (renderChat, ADR-2611030930gc) draws one conversation oldest first with the same turnView.
// Every value is a text node: nothing from a message is parsed as HTML.
import { answerView, filterChips, scanLeft, TONE_LABEL, jobsView, JOB_COLUMNS, typesText, flatCard } from './ask-logic.mjs';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

// ui: what the viewer opened, kept across re-renders (a new answer arriving must not close a card being read)
// waiting: question id → when it was first seen waiting; shown: question id → when its answer was first drawn (the fade-in)
export function newUi() { return { open: new Set(), strip: new Set(), filter: new Map(), earlier: false, waiting: new Map(), shown: new Map(), rated: new Set() }; }

// quote — a quoted passage or a plain line (no council: "The Clause 4.6 grounds, as argued", a heading the files are
// silent on): its words are the point, so they show at once, with no toggle (Oren, 3 Nov 2026: one "Details" per job)
function quote(c) {
  return el('article', { className: 'card qcard' }, el('h3', { textContent: c.place }), ...quoteBody(c));
}
const quoteBody = (c) => [
  ...(c.note ? [el('p', { className: 'note', textContent: c.note })] : []),
  ...(c.quote ? [el('blockquote', {}, `“${c.quote}”`, ...(c.where ? [el('small', { textContent: c.where })] : []))]
    : (c.where ? [el('p', { className: 'where', textContent: c.where })] : []))];

function card(c, key, ui, redraw) {
  if (!c.council && (c.quote || c.note)) return quote(c);
  const isOpen = ui.open.has(key);
  const toggle = () => { if (isOpen) ui.open.delete(key); else ui.open.add(key); redraw(); };
  const top = el('button', { type: 'button', className: 'top', onclick: toggle, ariaExpanded: String(isOpen) },
    el('span', { className: 'l1' }, el('span', { className: 'place' }, ...(c.council ? [el('span', { className: 'cn', textContent: c.council }), ' · '] : []), c.place),
      ...(c.key ? [el('b', { className: 'key', textContent: c.key })] : [])),
    el('span', { className: 'l2' }, ...(c.status ? [el('span', { className: `tag ${c.tone}`, textContent: c.status })] : []),
      ...(c.note && !isOpen ? [el('span', { className: 'nt', textContent: c.note })] : []),
      el('span', { className: 'chev', textContent: isOpen ? 'Close ▴' : 'Details ▾' })));
  const art = el('article', { className: `card${isOpen ? ' open' : ''}` }, top);
  if (isOpen) {
    art.append(el('div', { className: 'body' },
      ...(c.facts.length ? [el('div', { className: 'facts' }, ...c.facts.map(([k, v]) => el('span', {}, ...(k ? [el('i', { textContent: k })] : []), v)))] : []),
      ...(c.note ? [el('p', { className: 'note', textContent: c.note })] : []),
      ...(c.quote ? [el('blockquote', {}, `“${c.quote}”`, ...(c.where ? [el('small', { textContent: c.where })] : []))]
        : (c.where ? [el('p', { className: 'where', textContent: c.where })] : [])),
      ...(c.link ? [el('a', { className: 'link', href: c.link.url, target: '_blank', rel: 'noopener noreferrer', textContent: `${c.link.text} ↗` })] : [])));
  }
  return art;
}

// flat — one result in a `flat` room (the GSA chat; Oren + Elad, 5 Nov 2026, #gsa): its title line, the quote clamped to
// three lines (ask.html .flat blockquote), the source link. No toggle, no facts, no tag (ask-logic.mjs flatCard).
function flat(c) {
  const f = flatCard(c);
  return el('article', { className: 'card flat' }, el('h3', { textContent: f.title, dir: 'auto' }),
    ...(f.quote ? [el('blockquote', { textContent: `“${f.quote}”`, dir: 'auto' })] : []),
    ...(f.link ? [el('a', { className: 'link', href: f.link.url, target: '_blank', rel: 'noopener noreferrer', textContent: `${f.link.text} ↗` })]
      : (f.where ? [el('p', { className: 'where', textContent: f.where })] : [])));
}

function strip(cards) {
  return el('table', { className: 'strip' },
    el('thead', {}, el('tr', {}, ...['Address', 'Council', 'Decision', 'Key figure'].map((h) => el('th', { textContent: h })))),
    el('tbody', {}, ...cards.map((c) => el('tr', {}, el('td', { textContent: c.place }), el('td', { textContent: c.council }),
      el('td', {}, ...(c.status ? [el('span', { className: `tag ${c.tone}`, textContent: c.status })] : [])), el('td', { className: 'k', textContent: c.key })))));
}

function filterBar(id, cards, ui, redraw) {
  const on = ui.filter.get(id) || {};
  const set = (f, v) => { ui.filter.set(id, { ...on, [f]: v }); redraw(); };
  const chips = filterChips(cards);
  const row = (label, f, list) => el('div', { className: 'frow' }, el('span', { className: 'lbl', textContent: label }),
    el('button', { type: 'button', className: `chip${on[f] ? '' : ' on'}`, textContent: 'All', onclick: () => set(f, '') }),
    ...list.map(([v, n]) => el('button', { type: 'button', className: `chip${on[f] === v ? ' on' : ''}`, onclick: () => set(f, v) }, v, el('em', { textContent: String(n) }))));
  return el('div', { className: 'bar' }, row('Council', 'council', chips.council), row('Decision', 'status', chips.status));
}

const echo = (q) => el('p', { className: 'echo' }, el('b', { textContent: 'You asked' }), el('span', { textContent: q.text, dir: 'auto' }));

// rateRow — a guest's thumbs under one answer (ADR-2611030930gc): 👍 / 👎 open the note box (the note is optional); once
// sent the row says so (ui.rated, kept across redraws).
function rateRow(a, ui, rate) {
  if (ui.rated?.has(a.id)) return el('p', { className: 'rate' }, el('span', { className: 'done', textContent: '✓ Thank you for the feedback' }));
  return el('p', { className: 'rate' }, el('span', { textContent: 'Was this useful?' }),
    el('button', { type: 'button', textContent: '👍', title: 'Useful', ariaLabel: 'Useful', onclick: () => rate(a, 'up') }),
    el('button', { type: 'button', textContent: '👎', title: 'Not useful', ariaLabel: 'Not useful', onclick: () => rate(a, 'down') }));
}

function answer(q, a, ui, redraw, rate = null, isFlat = false) {
  const v = answerView(a);
  const sec = el('section', { className: 'ans' });
  sec.dataset.q = q?.text || '';
  if (q) sec.append(echo(q));
  if (a.understood) sec.append(el('p', { className: 'und' }, el('b', { textContent: 'Understood as' }), el('span', { textContent: a.understood, dir: 'auto' })));
  if (v.headline) sec.append(el('h2', { textContent: v.headline }));
  if (v.coverage) sec.append(el('p', { className: 'cov', textContent: v.coverage }));
  if (v.lead) sec.append(el('p', { className: v.headline ? 'lead' : 'lead plain', textContent: v.lead, dir: 'auto' }));
  if (!v.cards.length) { if (rate) sec.append(rateRow(a, ui, rate)); return sec; }
  if (isFlat) {
    sec.append(el('div', { className: 'cards' }, ...v.cards.map((c, i) => { const e = flat(c); e.style.setProperty('--i', String(i)); return e; })));
    if (rate) sec.append(rateRow(a, ui, rate));
    return sec;
  }
  const id = a.id;
  const on = ui.filter.get(id) || {};
  const tools = el('div', { className: 'tools' });
  const toolBtn = (label, isOn, flip) => el('button', { type: 'button', className: `tool${isOn ? ' on' : ''}`, textContent: label, onclick: flip });
  if (v.strip) tools.append(toolBtn(ui.strip.has(id) ? 'Hide table' : `Compare ${v.cards.length} in a table`, ui.strip.has(id),
    () => { if (ui.strip.has(id)) ui.strip.delete(id); else ui.strip.add(id); redraw(); }));
  if (v.filter) tools.append(toolBtn(on.shown ? 'Hide filter' : 'Filter', on.shown, () => { ui.filter.set(id, on.shown ? {} : { shown: true }); redraw(); }));
  if (tools.childElementCount) sec.append(tools);
  if (v.strip && ui.strip.has(id)) sec.append(strip(v.cards.filter((c) => c.council)));
  if (v.filter && on.shown) sec.append(filterBar(id, v.cards, ui, redraw));
  const keep = (c) => (!on.council || c.council === on.council) && (!on.status || TONE_LABEL[c.tone] === on.status);
  // passages under one heading share one card: the heading once, then each quote
  const box = el('div', { className: 'cards' }); let last = null; let n = 0;
  v.cards.forEach((c, i) => {
    if (!keep(c)) return;
    if (last && !c.council && !last.c.council && c.place === last.c.place && last.e.classList.contains('qcard')) { last.e.append(...quoteBody(c)); return; }
    const e = card(c, `${id}:${i}`, ui, redraw); e.style.setProperty('--i', String(n++)); box.append(e); last = { c, e };
  });
  sec.append(box);
  if (rate) sec.append(rateRow(a, ui, rate));
  return sec;
}

// scan — the waiting state: a row of file icons a soft sand light passes over, and the count of what is being read
// (the trust line's own numbers, `scope` = inventoryOf; plain words without it). `ms`: how long it has been showing, so
// a redraw continues the sweep and the count instead of restarting them.
function scan(scope, ms = 0) {
  const delay = `${-Math.max(0, ms)}ms`;
  const files = el('div', { className: 'files', ariaHidden: 'true' }, ...Array.from({ length: 14 }, (_, i) => {
    const f = el('span', { className: 'fi' }); f.style.setProperty('--i', String(i)); return f;
  }));
  files.style.setProperty('--d', delay);
  const count = scope
    ? el('p', { className: 'count' }, `Reading ${scope.jobs.length} jobs… `, el('b', { className: 'n', style: `--to:${scope.documents};--d:${delay}` }), ' documents')
    : el('p', { className: 'count', textContent: 'Reading your project files…' });
  return el('div', { className: 'scan', role: 'status' }, files, count);
}

// turnsOf — conversation() items as turns: each question with the answers that follow it.
function turnsOf(items) {
  const turns = [];
  for (const it of items) {
    if (it.kind === 'q') turns.push({ q: it, as: [] });
    else if (turns.length) turns[turns.length - 1].as.push(it);
  }
  return turns;
}

// turnView — one question and its answer(s) as the page draws it, in both modes: the scan while it is pending (held
// SCAN_MIN_MS), one plain line when no answer came back, else the sourced answer, its cards fading in once.
function turnView(t, ui, { redraw, scope = null, rate = null, flat: isFlat = false }, now) {
  if (!t.as.length && t.q.pending && !ui.waiting.has(t.q.id)) ui.waiting.set(t.q.id, now);
  const left = t.as.length ? scanLeft(ui.waiting.get(t.q.id), now) : 0;
  if (left) setTimeout(redraw, left + 20);
  if ((!t.as.length && t.q.pending) || left) return [el('section', { className: 'ans' }, echo(t.q), scan(scope, now - ui.waiting.get(t.q.id)))];
  if (!t.as.length) return [el('section', { className: 'ans' }, echo(t.q), el('p', { className: 'wait', textContent: 'No answer came back for this one.' }))];
  // an answer that followed a scan fades its cards in, once (a later redraw, such as opening a card, does not replay it)
  if (ui.waiting.has(t.q.id)) { ui.waiting.delete(t.q.id); ui.shown.set(t.q.id, now); }
  const fresh = now - (ui.shown.get(t.q.id) ?? -Infinity) < 1500;
  return t.as.map((a, i) => { const s = answer(i ? null : t.q, a, ui, redraw, rate, isFlat); if (fresh) s.classList.add('reveal'); return s; });
}

function empty(list, examples, ask) {
  list.append(el('p', { className: 'empty', textContent: 'Ask a question about your projects. Every answer shows the file and page it came from.' }));
  if (examples.length && ask) list.append(el('div', { className: 'ex' }, el('span', { textContent: 'Try' }), ...examples.map((x) => el('button', { type: 'button', textContent: x, onclick: () => ask(x) }))));
}

// renderLive — draws conversation() items into `list`: the newest question and its answer(s) first and whole, earlier
// questions folded into one line that opens them. `examples` are tappable questions for an empty room.
export function renderLive(list, items, ui, { redraw, examples = [], ask, scope = null } = {}) {
  list.replaceChildren();
  const turns = turnsOf(items);
  if (!turns.length) { empty(list, examples, ask); return; }
  const now = Date.now();
  const [last, ...rest] = [...turns].reverse();
  list.append(...turnView(last, ui, { redraw, scope }, now));
  if (rest.length) {
    list.append(el('button', { type: 'button', className: 'earlier', textContent: ui.earlier ? `Hide earlier questions` : `Earlier questions (${rest.length})`,
      onclick: () => { ui.earlier = !ui.earlier; redraw(); } }));
    if (ui.earlier) for (const t of rest) list.append(...turnView(t, ui, { redraw, scope }, now));
  }
}

// renderChat — a chat room's one conversation (ADR-2611030930gc), like a chat app: oldest at the top, the newest at the
// bottom, each answer the same sourced cards renderLive draws. `items` are one chatThreads() conversation's items.
// `rate` (a guest's page only): each answer gets its thumbs (rateRow), calling rate(answer, 'up' | 'down').
// `flat` (the GSA chat, 5 Nov 2026): each result is a flat card — title, three quoted lines, the source link.
export function renderChat(list, items, ui, { redraw, examples = [], ask, scope = null, rate = null, flat: isFlat = false } = {}) {
  list.replaceChildren();
  const turns = turnsOf(items);
  if (!turns.length) { empty(list, examples, ask); return; }
  const now = Date.now();
  for (const t of turns) list.append(...turnView(t, ui, { redraw, scope, rate, flat: isFlat }, now));
}

// renderJobs — "What's in this demo" (Oren, 3 Nov 2026, #gsa): every job the search covers, one row each, sortable by a
// click on a column's heading and narrowed by the search box. `st` ({ sort, dir, q }) is kept across redraws.
export function renderJobs(box, inv, st, redraw) {
  const rows = jobsView(inv.jobs, st);
  const head = JOB_COLUMNS.map(([k, label]) => {
    const on = st.sort === k;
    const th = el('th', {}, el('button', { type: 'button', textContent: `${label}${on ? (st.dir < 0 ? ' ▾' : ' ▴') : ''}`,
      onclick: () => { if (on) st.dir = -st.dir; else { st.sort = k; st.dir = k === 'docs' ? -1 : 1; } redraw(); } }));
    if (on) th.setAttribute('aria-sort', st.dir < 0 ? 'descending' : 'ascending');
    return th;
  });
  box.replaceChildren(el('table', { className: 'jobs' }, el('thead', {}, el('tr', {}, ...head)),
    el('tbody', {}, ...rows.map((j) => el('tr', {}, el('td', { className: 'k', textContent: j.job }), el('td', { textContent: j.address }),
      el('td', { textContent: j.council }), el('td', { className: 'n', textContent: String(j.docs) }), el('td', { textContent: typesText(j) }))))));
  return rows.length;
}

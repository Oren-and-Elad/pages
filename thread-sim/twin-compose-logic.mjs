// katya-pr/2.0-twin-app/twin-compose-logic.mjs — the PURE decisions for the Cleo 2 TWIN composer: the ONE
// sanctioned WRITE the twin window makes. twin-connect.js is READ-ONLY (its no-write spec greps it); this
// SEPARATE module holds the director-message write so that invariant stays intact and the write surface is
// exactly one narrow thing: a DIRECTOR's own message into cleo2-rooms, author-validated by
// firestore.shadow.rules (author == request.auth.token.email). This is what turns "watch Cleo 2" into "ask
// Cleo 2" — her brain (npm run twin) watches cleo2-rooms and drafts a WOULD-SEND reply (it NEVER sends).
//
// Zero DOM / zero SDK here — node-importable so CI unit-tests the message shape + the guards; twin-compose.js
// wires these into the DOM + the injected Firestore write fns.

// The default room the composer posts into when no room is open. MUST be a room the brain assembles a
// persona/context for — `cleo2-hq` is the brain's canonical persona room (config.rooms.personas +
// twin-boot's own cards land there); a bare `hq` gets a context-free turn (Fable F3).
export const TWIN_DEFAULT_ROOM = 'cleo2-hq';

// canPost(text) — a message is postable iff it has non-whitespace content. (No /key here — that's the
// twin-window no-/key rule; a secret must never be posted into a shadow room. twin-window.js's composer
// guard also refuses /key, so this is defence-in-depth.)
export function canPost(text) {
  return typeof text === 'string' && text.trim().length > 0 && !/^\s*\/key\b/i.test(text);
}

// directorMessageDoc({ text, author, now }) — the Firestore doc for a director's message into a shadow room.
// `from:'director'` + a real `author` (the caller's own email — the rules ENFORCE author == auth email) so
// Cleo 2's kernel reads it as a director turn, exactly like Cleo 1 reads elad-oren-rooms. Throws on empty
// text or a missing author (a write we refuse to make rather than post junk).
export function directorMessageDoc({ text, author, now = 0, serverTimestamp = null }) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) throw new Error('twin-compose: refusing to post an empty message');
  if (!author) throw new Error('twin-compose: refusing to post without an author (rules require author == your email)');
  // relayed:false is the kernel's "unprocessed message" contract — kernel/rooms.mjs ingests ONLY
  // where('relayed','==',false). A doc missing the field never matches the equality filter, so without
  // this the message renders but the brain never sees it (Fable F1 BLOCKER).
  // createdAt is the ONE message sort key (P4c / ADR-0040): the live console injects a `serverTimestamp`
  // factory (mods.serverTimestamp) so this message carries a Firestore server Timestamp and interleaves
  // with the kernel's Timestamp brain replies under the host's orderBy('createdAt'). A string createdAt
  // sorts AFTER every Timestamp and a `where(ts>=)` range silently drops Timestamp rows — so we never
  // write a numeric `ts`. The ISO fallback stays only for tests / a surface that predates serverTimestamp.
  return { from: 'director', author, text: body, relayed: false, createdAt: serverTimestamp ? serverTimestamp() : new Date(now).toISOString() };
}

// roomSeedDoc() — the merge payload written before each post to guarantee the room doc exists. It must be
// an IDEMPOTENT marker ONLY: the earlier {createdBy,createdTs,archived:false} re-stamped those fields on
// EVERY send — rewriting provenance and silently un-archiving a room the brain/director archived (Fable
// F9). `twinSeeded:true` alone is harmless and idempotent; a room with no `archived` field still shows
// (the list filters on `!archived`), and the brain owns real room metadata.
export function roomSeedDoc() {
  return { twinSeeded: true };
}

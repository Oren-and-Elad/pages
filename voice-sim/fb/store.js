// An in-memory Firestore for the simulator: the real console reads and writes here. Nothing leaves the browser.
export class Timestamp {
  constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
  toMillis() { return this._ms; } toDate() { return new Date(this._ms); } valueOf() { return this._ms; } toJSON() { return this._ms; }
  isEqual(o) { return o && o._ms === this._ms; }
  static now() { return new Timestamp(Date.now()); } static fromMillis(ms) { return new Timestamp(ms); } static fromDate(d) { return new Timestamp(d.getTime()); }
}
export const S = new Map();
const L = new Set();
const clone = (v) => (v instanceof Timestamp ? v : Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const getF = (d, f) => String(f).split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
const cmpV = (a, b) => { a = a instanceof Timestamp ? a._ms : a; b = b instanceof Timestamp ? b._ms : b; return a < b ? -1 : a > b ? 1 : 0; };
const parentOf = (p) => p.split('/').slice(0, -1).join('/');
const autoId = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
export const db = { type: 'db', path: '' };
const join = (base, segs) => [base && base.path, ...segs].filter((x) => x !== '' && x != null).join('/');
export function collection(base, ...segs) { const path = join(base, segs); return { type: 'collection', path, id: path.split('/').pop() }; }
export function doc(base, ...segs) {
  let path = join(base, segs); if (base && base.type === 'collection' && !segs.length) path = `${base.path}/${autoId()}`;
  return { type: 'document', path, id: path.split('/').pop(), parent: { type: 'collection', path: parentOf(path) } };
}
export const query = (ref, ...cs) => ({ type: 'query', path: ref.path, cs: [...(ref.cs || []), ...cs] });
export const where = (f, op, v) => ({ k: 'where', f, op, v });
export const orderBy = (f, dir = 'asc') => ({ k: 'orderBy', f, dir });
export const limit = (n) => ({ k: 'limit', n });
export const limitToLast = (n) => ({ k: 'limitToLast', n });
const SENT = (op, v) => ({ __op: op, v });
export const serverTimestamp = () => SENT('ts');
export const deleteField = () => SENT('del');
export const arrayUnion = (...v) => SENT('union', v);
export const arrayRemove = (...v) => SENT('remove', v);
export const increment = (n) => SENT('inc', n);
function setPath(o, f, val) {
  const ks = String(f).split('.'); let cur = o;
  for (const k of ks.slice(0, -1)) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; }
  const last = ks[ks.length - 1], old = cur[last];
  if (val && val.__op) {
    if (val.__op === 'del') { delete cur[last]; return; }
    if (val.__op === 'ts') val = Timestamp.now();
    else if (val.__op === 'union') val = [...(Array.isArray(old) ? old : []), ...val.v.filter((x) => !(old || []).includes(x))];
    else if (val.__op === 'remove') val = (Array.isArray(old) ? old : []).filter((x) => !val.v.includes(x));
    else if (val.__op === 'inc') val = (Number(old) || 0) + val.v;
  } else if (val && typeof val === 'object' && !(val instanceof Timestamp) && !Array.isArray(val)) {
    const o2 = {}; for (const [k, x] of Object.entries(val)) setPath(o2, k, x); val = o2;
  }
  cur[last] = val;
}
const resolve = (data) => { const o = {}; for (const [k, v] of Object.entries(data || {})) setPath(o, k, v); return o; };
export function write(path, data, mode = 'set') {
  const old = S.get(path);
  if (mode === 'delete') S.delete(path);
  else if (mode === 'set') S.set(path, resolve(data));
  else { const o = clone(old || {}); for (const [k, v] of Object.entries(data)) { if (mode === 'merge' && v && typeof v === 'object' && !v.__op && !(v instanceof Timestamp) && !Array.isArray(v) && !k.includes('.')) { const sub = clone(o[k] && typeof o[k] === 'object' ? o[k] : {}); for (const [k2, v2] of Object.entries(v)) setPath(sub, k2, v2); o[k] = sub; } else setPath(o, k, v); } S.set(path, o); }
  schedule();
}
let pending = false;
function schedule() { if (pending) return; pending = true; setTimeout(() => { pending = false; for (const l of L) fire(l); window.dispatchEvent(new Event('sim-store')); }, 0); }
function docSnap(path) {
  const has = S.has(path), d = S.get(path);
  return { id: path.split('/').pop(), ref: doc(db, path), exists: () => has, data: () => (has ? clone(d) : undefined), get: (f) => getF(d, f), metadata: { hasPendingWrites: false, fromCache: false } };
}
function run(q) {
  let ps = [...S.keys()].filter((p) => parentOf(p) === q.path);
  const cs = q.cs || [];
  for (const c of cs.filter((c) => c.k === 'where')) ps = ps.filter((p) => { const v = getF(S.get(p), c.f);
    switch (c.op) { case '==': return cmpV(v, c.v) === 0 && v !== undefined; case '!=': return v !== undefined && cmpV(v, c.v) !== 0; case '<': return v !== undefined && cmpV(v, c.v) < 0; case '<=': return v !== undefined && cmpV(v, c.v) <= 0;
      case '>': return v !== undefined && cmpV(v, c.v) > 0; case '>=': return v !== undefined && cmpV(v, c.v) >= 0; case 'in': return (c.v || []).some((x) => cmpV(v, x) === 0); case 'not-in': return v !== undefined && !(c.v || []).some((x) => cmpV(v, x) === 0);
      case 'array-contains': return Array.isArray(v) && v.includes(c.v); case 'array-contains-any': return Array.isArray(v) && v.some((x) => (c.v || []).includes(x)); default: return true; } });
  const obs = cs.filter((c) => c.k === 'orderBy');
  if (obs.length) { ps = ps.filter((p) => obs.every((o) => getF(S.get(p), o.f) !== undefined)); ps.sort((a, b) => { for (const o of obs) { const r = cmpV(getF(S.get(a), o.f), getF(S.get(b), o.f)) * (o.dir === 'desc' ? -1 : 1); if (r) return r; } return 0; }); } else ps.sort();
  const lim = cs.find((c) => c.k === 'limit'); if (lim) ps = ps.slice(0, lim.n);
  const lt = cs.find((c) => c.k === 'limitToLast'); if (lt) ps = ps.slice(-lt.n);
  return ps;
}
function snapOf(t, prev) {
  if (t.type === 'document') return { snap: docSnap(t.path), sig: JSON.stringify([S.has(t.path), S.get(t.path)]) };
  const ps = run(t), docs = ps.map(docSnap), prevIds = prev?.ids || [], prevSig = prev?.sigs || {};
  const sigs = Object.fromEntries(ps.map((p) => [p, JSON.stringify(S.get(p))]));
  const changes = [...ps.filter((p) => !prevIds.includes(p)).map((p) => ({ type: 'added', doc: docSnap(p), newIndex: ps.indexOf(p), oldIndex: -1 })),
    ...ps.filter((p) => prevIds.includes(p) && prevSig[p] !== sigs[p]).map((p) => ({ type: 'modified', doc: docSnap(p), newIndex: ps.indexOf(p), oldIndex: prevIds.indexOf(p) })),
    ...prevIds.filter((p) => !ps.includes(p)).map((p) => ({ type: 'removed', doc: docSnap(p), newIndex: -1, oldIndex: prevIds.indexOf(p) }))];
  const snap = { docs, size: docs.length, empty: !docs.length, forEach: (f) => docs.forEach(f), docChanges: () => changes, metadata: { hasPendingWrites: false, fromCache: false }, query: t };
  return { snap, sig: JSON.stringify([ps, sigs]), ids: ps, sigs };
}
function fire(l) { try { const r = snapOf(l.t, l.prev); if (l.prev && r.sig === l.prev.sig) return; l.prev = r; l.cb(r.snap); } catch (e) { console.error('[sim store]', e); } }
export function onSnapshot(t, a, b) {
  const cb = typeof a === 'function' ? a : typeof b === 'function' ? b : (a && a.next) || (() => {});
  const l = { t, cb, prev: null }; L.add(l); setTimeout(() => fire(l), 0); return () => L.delete(l);
}
export const getDoc = async (r) => docSnap(r.path);
export const getDocs = async (q) => snapOf(q.type === 'collection' ? query(q) : q, null).snap;
export const setDoc = async (r, d, o) => write(r.path, d, o && o.merge ? 'merge' : 'set');
export const updateDoc = async (r, d, ...rest) => { if (typeof d === 'string') { const o = {}; o[d] = rest[0]; for (let i = 1; i < rest.length; i += 2) o[rest[i]] = rest[i + 1]; d = o; } write(r.path, d, 'update'); };
export const addDoc = async (c, d) => { const r = doc(c); write(r.path, d, 'set'); return r; };
export const deleteDoc = async (r) => write(r.path, null, 'delete');
export const getFirestore = () => db;
export const initializeFirestore = () => db;
export const writeBatch = () => { const ops = []; return { set: (r, d, o) => ops.push(() => setDoc(r, d, o)), update: (r, d) => ops.push(() => updateDoc(r, d)), delete: (r) => ops.push(() => deleteDoc(r)), commit: async () => { for (const f of ops) await f(); } }; };
export const runTransaction = async (_db, fn) => fn({ get: getDoc, set: (r, d, o) => setDoc(r, d, o), update: (r, d) => updateDoc(r, d), delete: (r) => deleteDoc(r) });
export const documentId = () => '__name__';

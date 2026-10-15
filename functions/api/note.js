// POST /api/note — a site note or event, stored in the KV namespace SITE_NOTES (bound in Cloudflare Pages settings).
// Cleo reads them every few days and proposes improvements. No names, no cookies; the IP is never stored.
export async function onRequestPost({ request, env }) {
  if (!env.SITE_NOTES) return new Response('not configured', { status: 503 });
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 4000) return new Response('too large', { status: 413 });
  let b; try { b = await request.json(); } catch { return new Response('bad json', { status: 400 }); }
  const clip = (v, n) => String(v ?? '').slice(0, n);
  const rec = { where: clip(b.where, 200), note: clip(b.note, 2000), page: clip(b.page, 200), type: clip(b.type || 'note', 20), country: clip(request.cf?.country, 4), at: new Date().toISOString() };
  if (!rec.note && rec.type === 'note') return new Response('empty', { status: 400 });
  const key = `${rec.page.split('/')[1] || 'site'}:${rec.at}:${crypto.randomUUID().slice(0, 8)}`;
  await env.SITE_NOTES.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
  return new Response('ok');
}

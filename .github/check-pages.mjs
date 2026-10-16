// .github/check-pages.mjs — the one check every change to this repo passes before it is merged (and the check
// Cleo's reviewer re-runs on a build of this repo: `npm run check`). Plain Node, no dependencies.
//
// It fails when:
//   • an .html file is empty or is not an HTML document (no <!doctype html> and no <html>);
//   • a page links to a file in this repo that does not exist (href/src, relative or /pages/-rooted);
//   • any file carries something shaped like a secret (an API key, a GitHub token, a private key);
//   • any file is larger than 10 MB (GitHub Pages serves this repo as-is; a big file is a mistake).
// Run: `node .github/check-pages.mjs [repoRoot]`. Exit 0 = clean, 1 = findings (each printed on its own line).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '.');
const SITE_PREFIX = '/pages/'; // GitHub Pages serves this repo at https://oren-and-elad.github.io/pages/
const MAX_BYTES = 10 * 1024 * 1024;
const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.md', '.txt', '.svg', '.xml', '.yml', '.yaml']);
const SECRET_RES = [
  /sk-ant-[A-Za-z0-9_-]{20,}/, /\bgh[opsu]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bsk-[A-Za-z0-9]{40,}/,
];
const SKIP_DIRS = new Set(['.git', 'node_modules']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (e.isFile()) out.push(path.join(dir, e.name));
  }
  return out;
}

// localTarget — the repo file a link points at, or null when it is not a link into this repo.
export function localTarget(ref, fromFile, root = ROOT) {
  const r = String(ref || '').trim();
  if (!r || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\{|\$)/i.test(r)) return null; // http:, mailto:, data:, //host, #anchor, templates
  const clean = decodeURIComponent(r.split('#')[0].split('?')[0]);
  if (!clean) return null;
  let abs;
  if (clean.startsWith(SITE_PREFIX)) abs = path.join(root, clean.slice(SITE_PREFIX.length));
  else if (clean.startsWith('/')) abs = path.join(root, clean.slice(1));
  else abs = path.join(path.dirname(fromFile), clean);
  return abs;
}
function resolves(abs) {
  if (existsSync(abs) && statSync(abs).isFile()) return true;
  if (existsSync(path.join(abs, 'index.html'))) return true;
  return existsSync(`${abs}.html`);
}

export function checkRepo(root = ROOT) {
  const findings = [];
  for (const file of walk(root)) {
    const rel = path.relative(root, file);
    const size = statSync(file).size;
    if (size > MAX_BYTES) findings.push(`${rel}: ${(size / 1048576).toFixed(1)} MB is over the 10 MB limit`);
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    const text = readFileSync(file, 'utf8');
    for (const re of SECRET_RES) if (re.test(text)) findings.push(`${rel}: carries something shaped like a secret (${re.source.slice(0, 24)}…)`);
    if (ext !== '.html' && ext !== '.htm') continue;
    if (!text.trim()) { findings.push(`${rel}: the page is empty`); continue; }
    if (!/<!doctype html|<html[\s>]/i.test(text)) findings.push(`${rel}: not an HTML document (no <!doctype html> or <html>)`);
    const refRe = /\s(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
    for (const m of text.matchAll(refRe)) {
      const abs = localTarget(m[2], file, root);
      if (abs && !resolves(abs)) findings.push(`${rel}: links to ${m[2]}, which is not in this repo`);
    }
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-pages.mjs')) {
  const findings = checkRepo(ROOT);
  for (const f of findings) console.log(f);
  console.log(findings.length ? `pages check: ${findings.length} finding(s)` : 'pages check: clean');
  process.exit(findings.length ? 1 : 0);
}

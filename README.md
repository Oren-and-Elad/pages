# pages — Cleopatra's quick static pages

Marketing and one-off pages (a card for a prospect, an offer, an event, a demo deck). Plain HTML, no build, no keys,
no bot. GitHub Pages serves `main` as-is at https://oren-and-elad.github.io/pages/ within a minute or two of a merge.
One folder per page: `start-v4/` → https://oren-and-elad.github.io/pages/start-v4/.

How a change gets here: a pull request, then `main`. Every pull request runs **Pages · Check**
(`.github/workflows/check.yml` → `npm run check` → `.github/check-pages.mjs`): every page is an HTML document, every
link into this repo resolves, nothing is shaped like a secret, no file is over 10 MB. Cleo's build rooms open those
pull requests themselves and merge them when the check is green (cleo2 `build.targets.pages-build`, ADR in
`cleo2/docs/decisions/`). Run `npm run check` before you commit.

This repo is public, and so is every page in it: anyone can read every folder. Never put anything here that a
client or a stranger must not see.

Rules: no client names unless a director asked; no prices; no secrets; no scripts that send data anywhere.
One exception (Oren, 19 Oct 2026): `gsa-demo-v3`'s phone remote sends only slide numbers through the public relay
ntfy.sh, and only when the page is opened with a private `?remote=CODE` link; the code is never written in this repo.
Anything that answers visitors on its own (Ask Cleo) lives in cleo2 `app/onepager/`, not here.
Decided by Oren, 15 Oct 2026; the build lane and the check by Oren, 17 Oct 2026.

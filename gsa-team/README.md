# gsa-chat — GSA's own chat page

**Source of truth since 6 Nov 2026: this folder in the gsa-planning repo.** `node web/build.mjs` writes the two private
links into `dist/`: `gsa-chat/` (decision makers: Chat, Job board, Pricing; `gsa-trial/answers/` and its code) and
`gsa-team/` (senior staff: its own room `gsa-team`, own guest list, Chat and Job board only; `gsa-trial/team-answers/` and its own code; opens only its room
room). Both take a 2,000-character question. Publishing = copying those folders to the pages repo (the ship lane).

Live: https://oren-and-elad.github.io/pages/gsa-chat/ (the old link `https://cleo2.pages.dev/elad-and-oren/ask.html#gsa-chat`
forwards here). Owned by room #gsa and its builder since 5 Nov 2026 (Oren, #hq2): its look, tabs, sign-in screen and
feedback are changed here, and nowhere in Cleo's console.

- `index.html` the page and its styles · `ask.js` sign-in, chat, tabs, feedback · `ask-view.js` how an answer is drawn ·
  `ask-logic.mjs` the room table (`ASK_ROOMS['gsa-chat']`: look, tabs Chat / Job board / Pricing, the prepared answers
  page) and the pure helpers · `assets/gsa-logo.svg`.
- Sign-in: the same Firebase project as before (`cleo2-1812b`); guests sign in with the `gsa-1` … `gsa-6` logins, staff
  with Google. Who may sign in, the end date and the off switch stay in Cleo (`elad-oren-guests`, the room doc).
- The Job board and Pricing tabs open `../gsa-trial/answers/` with the same access code (the room doc's `preparedCode`).
- Answers: the page writes the question into the room; the relay asks GSA's own server on port 21160 (`~/lab-gsa`).

## How a change goes live
Ask #gsa. The page build goes through the pages lane: build → QA → a `cleo-ship-<sha>` PR → `Pages · Check` green →
merged with no tap → GitHub Pages serves it in about a minute. Keep every change inside `gsa-chat/` (or `gsa-trial/`): a
change to a root file is sent back to the builder once to drop it. Check it live at the URL above.

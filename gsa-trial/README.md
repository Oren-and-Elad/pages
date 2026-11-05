# gsa-trial — the GSA trial demo, encrypted

Oren, decision card 27 Oct 2026: this folder may hold the GSA trial demo's preset answers, which quote the client's
files — an exception to the repo's "nothing a client must not see" rule, allowed only because nothing here is readable.
The whole content is encrypted (AES-256-GCM, key from an access code by PBKDF2-SHA256, 600,000 rounds) and decrypted
only in the visitor's browser. The code is never written in this repo; it reaches the directors through the console.

Since 5 Nov (pages clean-up, director-approved): the slideshow is gone; the folder root only forwards to `answers/`.

Since 2 Nov (Oren, #gsa, for the 4 Nov demo at GSA): `answers/` holds the demo's 13 prepared answers (Halina 1–3,
checks 1–6, job board, fee proposal to job, prospects by area), same encryption, its own access code (given to the
directors in the console). Built by ~/god-work/gsa-demo-link/build.mjs from the Mac's demo. No free-text box.

Since 5 Nov (Oren, for the 6 Nov demo; browser test: tests/gsa-trial-jobboard.test.mjs): the Job board tab lets the visitor give a job a planner and move its stage. The
change lives only in that browser (localStorage), "Reset demo" restores the board; no server, nothing sent. The editor
is plain script in the page wrapper (no content in it); the locked content is unchanged.

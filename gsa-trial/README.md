# gsa-trial — the GSA trial demo, encrypted

Oren, decision card 27 Oct 2026: this folder may hold the GSA trial demo's preset answers, which quote the client's
files — an exception to the repo's "nothing a client must not see" rule, allowed only because nothing here is readable.
The whole content is encrypted (AES-256-GCM, key from an access code by PBKDF2-SHA256, 600,000 rounds) and decrypted
Since 28 Oct (Oren, #gsa): the page is the demo presentation (Next/Back, 7 slides: opening, the trial, Halina's 3 questions with Copilot beside where stored, Q3 in two layers, the price slide). Built by ~/god-work/gsa-present/build.mjs on the Mac, same access code.
only in the visitor's browser. The code is never written in this repo; it reaches the directors through the console.

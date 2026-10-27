# gsa-trial — the GSA trial demo, encrypted

Oren, decision card 27 Oct 2026: this folder may hold the GSA trial demo's preset answers, which quote the client's
files — an exception to the repo's "nothing a client must not see" rule, allowed only because nothing here is readable.
The whole content is encrypted (AES-256-GCM, key from an access code by PBKDF2-SHA256, 600,000 rounds) and decrypted
only in the visitor's browser. The code is never written in this repo; it reaches the directors through the console.
Built from gsa-planning c509dcc (BUG-013 spot-check fixes, 28 Oct; `demo.preset_answer` + `demo.render`, the 9 presets); free-text questions are not here.

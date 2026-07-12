# Demo — organizing real IRS forms in JavaScript

These scripts prove the organizer on **real IRS forms**, in plain Node.js (no Acrobat needed).
The blank IRS PDFs are **downloaded from irs.gov on first run** (they are gitignored, not committed),
so a fresh clone reproduces everything with just `npm install`.

| Command | What it does |
|---|---|
| `npm run demo` | Downloads the real **Form 1042-S**, stamps 10 different names into Box 13a across 20 forms (each paired with its *Instructions for Recipient* page), **shuffles** them, writes `output/unorganized-1042s.pdf`, then **organizes** into `output/organized-1042s.pdf` (grouped + A→Z) plus one PDF per recipient — and verifies no page is lost and every form keeps its instruction. |
| `node demo/inspect.mjs` | Prints the page layout and the exact positions of Box 13a/13b/13c on the real 1042-S. |
| `node demo/inspect-forms.mjs` | Downloads the real **1099-NEC, W-2, and 1042** and prints where each form's name box sits (used to calibrate multi-form detection). |

Outputs land in `demo/output/` (gitignored). Nothing here touches or modifies the source PDFs.

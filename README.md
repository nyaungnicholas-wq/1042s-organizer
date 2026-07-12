# 📄 1042-S Organizer for Adobe Acrobat

**Takes a messy multi-recipient IRS 1042-S PDF and organizes it — sorts every form by the
recipient's name and keeps each form together with its instruction page.**

<br>

## 👉 The ONE file you copy: **[`1042s-organizer.js`](1042s-organizer.js)**

> Everything else in this repo (the `demo`, `test`, `research` folders) is just proof that it
> works. **You can ignore all of it.** You only ever copy that one file.

### How to use it — 3 steps

**1.** Click **[`1042s-organizer.js`](1042s-organizer.js)** above, then click the **“Copy raw file”**
button (the little clipboard icon at the top-right of the code box). That copies the whole thing.

**2.** Open **Adobe Acrobat Pro**, then press **Ctrl + J** (Windows) or **⌘ + J** (Mac) to open the
**JavaScript Console** (the black box at the bottom).

**3.** **Paste** it into that box, select it all, and press **Ctrl + Enter**. Then type `organize()`
and press **Ctrl + Enter** again.

Done — it organizes your open PDF. Full walkthrough (and how to double-check it first) is farther down.

<br>

---

## What it does

Splits and organizes a big multi-recipient **IRS Form 1042-S** PDF by the recipient's
name in **Box 13a**. It:

- **Groups** every page that belongs to a recipient — the form copies **and** the
  no-name instruction pages that follow them — so a form never gets separated from its
  instructions.
- **Sorts** recipients alphabetically, turning a jumbled **A B A** into a clean **A A B**.
- **Writes** one PDF per recipient (named after them) **and** one combined sorted PDF.
- **Double-checks itself** and prints a report before it writes anything.
- Lets you **pull up any recipient's form on demand**: `find("Smith")`.

> **Your question — 1042 or 1042-S?** These are **Form 1042-S** ("Foreign Person's U.S.
> Source Income Subject to Withholding"). **Box 13a = Recipient's name** is specifically a
> 1042-S box (Form 1042 is the *summary* return and has no per-recipient 13a). The script
> targets the 1042-S layout. See [`research/1042-S-field-map.md`](research/1042-S-field-map.md).

---

## See it work first — on the REAL IRS form (no Acrobat)
Want proof before touching Acrobat? Run the built-in demo (JavaScript, via pdf-lib + pdfjs):
```
npm install
npm run demo
```
It **downloads the actual IRS Form 1042-S** from irs.gov, stamps **different recipient names into
Box 13a** on real Copy B pages, mixes in the real "Instructions for Recipient" page, and **shuffles
them** into `demo/output/unorganized-1042s.pdf` (recipients out of order, A B A …). Then it reads the
real text back the way Acrobat would and runs the **actual organizer logic** to write
`demo/output/organized-1042s.pdf` (grouped + sorted, A A B …) plus one PDF per recipient. It verifies
every stamped Box 13a name was read back correctly and that no page was lost. Open the two PDFs side
by side to see exactly what the Acrobat version does to your real file.

---

## What you need
- **Adobe Acrobat Pro** (the free Reader can't split/save files — Pro is required).
- Your 1042-S PDF must be **searchable** (real text, not a flat scan). You said it is. ✅
- **Save the PDF to disk first** (File > Save). The tool writes the split files next to it,
  so it needs to know where the file lives. It refuses to run on an unsaved document.

---

## One-time setup (enable the console)
1. Acrobat menu → **Preferences** → **JavaScript**.
2. Check **Enable JavaScript** and **Enable menu items JavaScript execution privileges**.
3. Click OK.

---

## How to run it

### Step 1 — Load the script
1. Open your 1042-S PDF in Acrobat and make sure it's the **front window**.
2. Press **Cmd+J** (Mac) or **Ctrl+J** (Windows) to open the JavaScript Console.
3. Open [`1042s-organizer.js`](1042s-organizer.js), **select all, copy**, and **paste** it
   into the console's big text area.
4. With the pasted text still selected, press **Ctrl+Enter** (or **Enter** on the numeric
   keypad) to run it. You'll see `1042-S Organizer loaded.`

### Step 2 — Calibrate (confirm it reads the name right)
Type these in the console (press Ctrl+Enter after each):
```js
testName(1)      // reads Box 13a on page 1, shows what it found
scan(1, 20)      // quick pass: page | is-it-a-form | recipient name
```
- If the names look **correct**, go to Step 3.
- If a name looks **wrong or blank**, run `dumpWords(1)` — it prints every word on page 1
  with its coordinates. That output tells me exactly where Box 13a sits on your layout.
  **Privacy note:** that dump contains real taxpayer names. Before sharing it, you can
  **replace the actual name words with dummy text** (e.g. `AAAA BBBB`) — I only need the
  *coordinates and the box labels*, not the real names. (Different tax-software vendors place
  the name slightly differently; this is the one thing worth checking on your real file.)

### Step 3 — Dry run (safe: writes nothing)
```js
organize()
```
This scans all pages and prints the **VERIFICATION REPORT**: total pages, number of
recipients, a sorted recipient index, and a **FLAGS / THINGS TO REVIEW** section. Read it.
Nothing has been written yet.

### Step 4 — Real run (writes the files)
If the report looks right:
```js
CONFIG.dryRun = false
organize()
```
It writes, **into the same folder as your original PDF**:
- `1042S_<Recipient Name>.pdf` — one per recipient (this is the "give me my form" file).
- `_ORGANIZED_1042S_sorted.pdf` — everyone, grouped and alphabetical (the **A A B** version).
- `_REVIEW_unmatched_head.pdf` — *only if* some pages came before the first recognizable form.
- `_REVIEW_unreadable_forms.pdf` — *only if* a page looked like a form but its name couldn't be
  read; these are set aside for you rather than guessed into the wrong recipient's file.

For ~1,125 pages this takes a few minutes. Progress prints as it goes. **Your original PDF
is never modified.**

### Step 5 — Retrieve a recipient's form any time
After `organize()` has run in this console session:
```js
find("Smith")                 // fuzzy match — opens their PDF
find("acme")                  // case-insensitive, partial ok
openForm("ACME CORPORATION")  // exact name
```
Starting a fresh session later? Reopen the original PDF, re-paste the script, then run
`rebuildIndex()` once and `find()` works again.

Want a spreadsheet of the whole run (which recipient is in which file, and which pages)?
```js
exportIndexCSV()
```
It prints CSV to the console — copy it into a file named `index.csv` and open in Excel. (Names
are sanitized against spreadsheet formula-injection, since they come from the PDF.)

---

## More than 1042-S: 1099, W-2, and 1042 too
The PDF can hold a mix of form types. The tool detects the form type on each page and reads the
recipient/employee name from **that form's** box, then groups every form for the same person into
**one file per recipient** (John Smith's 1042-S *and* his 1099 *and* his W-2 land in one
`1042S_John Smith.pdf`, sorted A→Z). Each form keeps its instruction page.

| Form | How the recipient is found | Status |
|------|----------------------------|--------|
| **1042-S** | Box 13a (below "13a", left of "13b", above "13c") | precise, tested on the real IRS form |
| **1099 series** | value below the "RECIPIENT'S name" label | best-effort — calibrate with your sample |
| **W-2** | employee name in box **e** ("Employee's first name…") | best-effort — calibrate with your sample |
| **1042** (annual) | no recipient (it's the filer's summary) → goes to its own file under the withholding agent's name | routed separately |

**Calibrating the other forms:** because every vendor lays out 1099/W-2 slightly differently, confirm
detection on your file with `identifyForm_page(1)` (and `dumpWords(1)` if a name reads wrong), then tune
the label lists in the `FORM_CONFIG` block near the top of the script. Send me a sample page of each
form type (names can be redacted) and I'll finalize the exact boxes.

## The rule it follows (your algorithm)
```
currentName = ""
for each page:
    if the page is a 1042-S form AND Box 13a has a name:
        if that name is different from currentName:
            start a new packet   (this begins a new recipient)
        currentName = that name
    else:                         (instruction page / no name)
        add this page to the current recipient's packet
```
Then all packets with the same name are grouped together and sorted alphabetically.
Instruction pages have no name, so they ride along with the form they follow — that's how
"form A goes with its instruction, form B goes with its instruction" is preserved.

---

## The double-check
Before (dry run) and after writing, it reports:
- **Coverage** — confirms every page landed in exactly one place (no page lost).
- **Two independent name readers** — one by box position (primary), one by reading order; it
  flags any page where they disagree. (The reading-order one is a bonus cross-check; the
  position reader is the reliable one, so a blank cross-check is not itself an error.)
- **No-name / unreadable form pages** — quarantined to `_REVIEW_unreadable_forms.pdf` rather
  than being guessed into the previous recipient's file.
- **Pages before the first form** — saved to `_REVIEW_unmatched_head.pdf` instead of guessing.
- **Rotated pages** — flagged, because a sideways page can misread; un-rotate/flatten and re-run.
- **Oversized packets** — could mean a name split was missed.
- **Same name in more than one place** — grouped together (that's the A A B behavior), but
  flagged so that if two *different* entities happen to share a legal name you can check the TIN.
- **Near-duplicate names** — e.g. `ACME CORPORATION` vs `ACME CORPORATON` (a likely typo);
  these are **not** merged automatically — it flags them so you decide.

The report ends with **PASS** or **REVIEW ITEMS ABOVE**.

### Built to be careful with tax data
- **Never overwrites your original** — if an output name would collide with the source file, it
  skips it and warns.
- **Foreign recipients** — non-Latin names (e.g. `株式会社トヨタ`, `Газпром`) are kept as
  distinct recipients, not merged. (1042-S is all about foreign persons, so this matters.)
- **Placeholder values** — `Unknown Recipient` and `Withholding rate pool` are valid Box 13a
  values that legitimately repeat for *different* payees, so they are kept in **separate** files
  (`Unknown Recipient`, `Unknown Recipient (2)`, …), never merged into one.
- **Filenames are sanitized** — a garbage or malicious name in Box 13a can't escape the output
  folder, use a reserved device name, or inject control characters.
- Recipient names are printed to the console and become filenames (that's the point) — the
  outputs contain taxpayer PII, so keep the folder somewhere appropriately secured.

*(These behaviors were confirmed by an automated multi-agent audit plus a Node test suite;
run `node test/mock-run.js` and `node test/stress-run.js` — 42 checks.)*

---

## Settings (top of the script)
| Setting | Default | Meaning |
|---|---|---|
| `CONFIG.dryRun` | `true` | `true` = analyze only. Set `false` to actually write files. |
| `CONFIG.mode` | `"both"` | `"split"` (per-recipient), `"combine"` (one sorted file), or `"both"`. |
| `CONFIG.outputFolder` | `""` | `""` = same folder as the PDF. Or a full path to an **existing** folder. |
| `CONFIG.packetOutlierPages` | `8` | Flag any single packet bigger than this. |
| `CONFIG.similarNameThreshold` | `0.86` | How similar two names must be to be flagged as possible duplicates. |

## Reusing it on future 1042-S files
Same layout next year? Just open the new PDF, paste the script, `testName(1)` to confirm,
then `organize()`. No changes needed unless a vendor changes the form's text layout.

## Troubleshooting
- **"no active PDF"** → click your PDF window to make it front, then re-paste the script.
- **"this PDF isn't saved to disk"** → File > Save first, then re-run.
- **Names blank / wrong** → run `dumpWords(1)` and send me the (name-redacted) output; quick tune.
- **A file failed to write** → the run keeps going and lists failures at the end (usually a
  weird character in a name; the script already strips the illegal ones).
- **"output path collides with your source"** → change `CONFIG.filePrefix` or set a separate
  `CONFIG.outputFolder`; the tool skipped those to protect your original.
- **Report shows rotated pages** → un-rotate/flatten the PDF (Acrobat: Organize Pages > Rotate,
  then Save) and re-run, so names aren't misread.
- **Windows flashing open/closed during the combined build** → normal; Acrobat opens the new
  file to assemble it. Use `CONFIG.mode = "split"` if you'd rather avoid that.

## Adobe Acrobat compatibility (verified)
The organizer script was checked against Adobe's official *JavaScript for Acrobat API Reference*:
- It uses **only documented Acrobat API methods** — `console.println`, `getPageNumWords` /
  `getPageNthWord` / `getPageNthWordQuads`, `getPageBox` / `getPageRotation`, `extractPages` /
  `insertPages`, `app.openDoc`, `saveAs`, `closeDoc` — each with the correct signature and argument form.
- Every file-writing call (`extractPages`, `insertPages`, `saveAs`, `openDoc`) is a **privileged**
  operation that is permitted from the **JavaScript Console** (Cmd/Ctrl+J) — the context these
  instructions tell you to use — so nothing needs a trusted function.
- The code is written to **ES3** (the safe target for Acrobat's engine): no arrow functions,
  `let`/`const`, template literals, or ES5+ array methods. The single modern call
  (`String.prototype.normalize`, for macOS filename comparison) is feature-detected and degrades
  gracefully on older engines.
- **Verdict: it pastes-and-runs in Acrobat Pro's Console with no changes.** One caveat, already handled:
  rotated pages can misread, so the tool detects and flags them and asks you to un-rotate first.

## Developer note
The real detection/grouping/sorting/security logic is tested against synthetic 1042-S data under
Node — no Acrobat needed. Run all of it with:
```
npm test
```
- `test/mock-run.js` — basic correctness (14 checks)
- `test/stress-run.js` — scale, foreign names, placeholders, quarantine, adversarial filenames,
  source-overwrite guard (28 checks)
- `test/random-run.js` — **600 randomized ~100-page documents** with many companies and random
  instruction placement, asserting no page is ever lost, packets stay disjoint, and filenames stay
  safe (600 docs)

Total: **642 checks**. See `research/1042-S-field-map.md` for the form research.

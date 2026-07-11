/* =====================================================================
   IRS 1042-S ORGANIZER  —  Adobe Acrobat JavaScript   (v2, hardened)
   ---------------------------------------------------------------------
   WHAT IT DOES
     Reads a big multi-recipient 1042-S PDF, finds each recipient's name
     in Box 13a, groups every page that belongs to a recipient (the form
     copies AND the no-name instruction pages that follow them), sorts the
     recipients alphabetically (turns  A B A  into  A A B ), and writes:
        • one PDF per recipient   (named after the recipient)  -> "give me my form"
        • one combined sorted PDF (everyone, grouped + alphabetical)
     It DOUBLE-CHECKS itself and prints a report before/after writing.

   HOW TO RUN  (see README.md for the full walkthrough)
     1. Open your 1042-S PDF in Acrobat Pro and SAVE it to disk once.
     2. Open the JavaScript Console:  Cmd+J (Mac) / Ctrl+J (Windows).
        (Enable it first: Preferences > JavaScript > check both boxes.)
     3. Paste this ENTIRE file, select all, press Ctrl+Enter to load it.
     4. CALIBRATE:   testName(1)    scan(1, 20)     (confirm names read right)
     5. DRY RUN:     organize()                     (analyzes, writes NOTHING)
     6. REAL RUN:    CONFIG.dryRun = false           then   organize()
     7. RETRIEVE:    find("Smith")                   (opens their PDF)

   Your original PDF is never modified. Written files land next to it by default.
   ===================================================================== */

var G_DOC = this;   /* captured at paste time = your active PDF */

var CONFIG = {
  /* ---- the two switches you'll actually touch ---- */
  dryRun: true,                 // true = analyze + verify only (no files). Set false to write.
  mode: "both",                 // "split" | "combine" | "both"

  /* ---- where files go ---- */
  outputFolder: "",             // "" = same folder as the source PDF. Otherwise a full path that EXISTS.
  filePrefix: "1042S_",         // per-recipient filename prefix (also protects the source from collision)
  combinedName: "_ORGANIZED_1042S_sorted.pdf",

  /* ---- detection knobs (rarely need changing) ---- */
  crossCheck: true,             // run a 2nd independent name reader and flag disagreements
  maxNameWords: 10,             // if the "name box" holds more words than this, treat as no-name
  padPts: 2,                    // small padding (points) around the name box
  rightColumnFraction: 0.62,    // fallback right edge of name box if 13b not found
  boxHeightFraction: 0.06,      // fallback name-band height if 13c not found
  minRowGapPts: 6,              // 13a and 13c must be at least this far apart vertically (rows)
  maxRowGapPts: 140,            // ...but not a whole page apart (rejects prose that merely cites boxes)
  colAlignTolPts: 45,           // 13a and 13c must sit in the same left column (rejects scattered prose)
  labelLineTolPts: 3,           // how close (points) counts as "on the same line as a label"

  /* ---- review helpers ---- */
  packetOutlierPages: 8,        // flag any single packet larger than this many pages
  similarNameThreshold: 0.86,   // 0..1; flag recipient names this similar (possible dupes/typos)
  nearDupeMaxNames: 1500,       // skip the (n^2) near-dupe scan above this many recipients
  indexPrintCap: 150            // cap how many recipients are printed to the console index
};

/* names that are NOT real entities — must never be merged across the document */
var PLACEHOLDER_KEYS = { "unknownrecipient": 1, "unknown": 1, "withholdingratepool": 1, "withholdingratepoolgeneral": 1 };

/* MULTI-FORM support. The PDF can contain 1042-S, 1099, W-2, and 1042 (annual) forms.
   1042-S is precise (13a/13b/13c box). The 1099/W-2 name boxes are anchored on their
   labels with best-effort defaults — CALIBRATE these with your sample forms by running
   identifyForm(pageNum) and dumpWords(pageNum), then adjust the label token lists below. */
var FORM_CONFIG = {
  enable1099: true,
  enableW2: true,
  enable1042annual: true,
  label1099: ["recipients", "name"],                 // 1099: "RECIPIENT'S name"
  labelW2: ["employees", "first"],                   // W-2 box e: "Employee's first name and initial"
  label1042agent: ["name", "of", "withholding", "agent"], // 1042 annual: filer, not a recipient
  annualGroupName: "1042 Annual Return (filer)"       // 1042 annual pages go to their own file
};

/* ---------------------------------------------------------------------
   small utilities
   ------------------------------------------------------------------- */
function P(s){ try { console.println(String(s)); } catch (e) {} }

/* normalize a token for matching/identity.
   Strips ASCII control/punctuation/whitespace but KEEPS digits, a-z, and ALL
   non-ASCII letters (CJK, Cyrillic, accented, Arabic) so foreign company names
   keep a distinct identity. ASCII-only input yields the same result as before. */
function normTok(t){
  if (t === null || t === undefined) return "";
  return String(t).toLowerCase().replace(/[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\s]+/g, "");
}
function trim(s){ return String(s).replace(/^\s+|\s+$/g, ""); }
function collapse(s){ return String(s).replace(/\s+/g, " "); }

function cleanName(s){
  if (!s) return "";
  s = collapse(trim(s));
  s = s.replace(/^[\s,;:.\-|]+|[\s,;:.\-|]+$/g, "");
  if (s.length > 160) s = s.substring(0, 160);
  return trim(s);
}

function isPlaceholderName(name){ return PLACEHOLDER_KEYS[normTok(name)] === 1; }

/* Turn an UNTRUSTED Box 13a value into a safe filename.
   The recipient name comes out of the PDF, so it must not be able to escape the
   output folder or produce a dangerous file. Strips path separators, control
   chars (incl. NUL), collapses ".." traversal runs, neutralizes Windows reserved
   device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9). */
function safeFilename(s){
  if (s === null || s === undefined) return "";
  s = String(s);
  s = s.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");            // C0 + DEL + C1 control chars (incl. NUL)
  s = s.replace(/[\\\/:\*\?"<>\|]/g, " ");                // path separators + Win/Mac-illegal chars
  s = collapse(trim(s));
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  s = s.replace(/\.{2,}/g, ".");                          // collapse ".." runs (traversal)
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  var stem = s.split(".")[0];
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) s = "_" + s;
  if (s.length > 120) s = trim(s.substring(0, 120));
  s = s.replace(/[.\s]+$/g, "");
  return s;
}

function folderOf(path){ return String(path).replace(/[^\/]+$/, ""); }
function ensureSlash(p){ p = String(p); return (p.charAt(p.length - 1) === "/") ? p : (p + "/"); }
/* canonicalize a device-independent path for the "did we hit the source?" guard:
   NFC-normalize (so macOS composed/decomposed names compare equal), lowercase,
   drop trailing slashes, and resolve . / .. segments. */
function canonPath(p){
  p = String(p);
  if (String.prototype.normalize){ try { p = p.normalize("NFC"); } catch (e) {} }
  p = p.toLowerCase().replace(/\/+$/, "");
  var parts = p.split("/"), out = [], i, seg;
  for (i = 0; i < parts.length; i++){ seg = parts[i]; if (seg === ".") continue; if (seg === ".."){ if (out.length) out.pop(); continue; } out.push(seg); }
  return out.join("/");
}
function samePath(a, b){
  if (!a || !b) return false;
  return canonPath(a) === canonPath(b);
}
function pad(n, w){ var s = String(n); while (s.length < w) s = " " + s; return s; }

/* a sorted list of 0-based page indices -> array of contiguous {s,e} ranges */
function pagesToRanges(pages){
  var out = [], i, s, e;
  if (!pages || !pages.length) return out;
  s = pages[0]; e = pages[0];
  for (i = 1; i < pages.length; i++){
    if (pages[i] === e + 1) { e = pages[i]; }
    else { out.push({ s: s, e: e }); s = pages[i]; e = pages[i]; }
  }
  out.push({ s: s, e: e });
  return out;
}

/* ---------------------------------------------------------------------
   word geometry
   ------------------------------------------------------------------- */
function bboxFromQuads(quads){
  if (!quads) return null;
  var xs = [], ys = [], qi, k, q;
  for (qi = 0; qi < quads.length; qi++){
    q = quads[qi];
    if (typeof q === "number"){
      for (k = 0; k < quads.length; k += 2){ xs.push(quads[k]); ys.push(quads[k + 1]); }
      break;
    } else if (q && q.length){
      for (k = 0; k < q.length; k += 2){ xs.push(q[k]); ys.push(q[k + 1]); }
    }
  }
  if (!xs.length) return null;
  return { xmin: Math.min.apply(null, xs), xmax: Math.max.apply(null, xs),
           ymin: Math.min.apply(null, ys), ymax: Math.max.apply(null, ys) };
}

function pageDims(doc, p){
  try { var b = doc.getPageBox("Crop", p); return { w: Math.abs(b[2] - b[0]), h: Math.abs(b[1] - b[3]) }; }
  catch (e) { return { w: 612, h: 792 }; }
}

function pageWords(doc, p){
  var out = [], n = 0, i, t, bb, xc, yc;
  try { n = doc.getPageNumWords(p); } catch (e) { return out; }
  for (i = 0; i < n; i++){
    t = "";
    try { t = doc.getPageNthWord(p, i, true); } catch (e2) { t = ""; }
    if (t === null || t === undefined) t = "";
    bb = null;
    try { bb = bboxFromQuads(doc.getPageNthWordQuads(p, i)); } catch (e3) { bb = null; }
    xc = 0; yc = 0;
    if (bb){ xc = (bb.xmin + bb.xmax) / 2; yc = (bb.ymin + bb.ymax) / 2; }
    out.push({ i: i, text: t, ntext: normTok(t), bb: bb, xc: xc, yc: yc });
  }
  return out;
}

function findAnchor(words, tok){
  for (var i = 0; i < words.length; i++){ if (words[i].ntext === tok) return words[i]; }
  return null;
}

/* is this a 1042-S FORM page? requires 13a/13b/13c laid out as the recipient box:
   13a & 13c in the same left column a sensible distance apart, 13b to their right.
   This rejects instruction/prose pages that merely cite box numbers. */
function isFormPage(words){
  var a = findAnchor(words, "13a"), b = findAnchor(words, "13b"), c = findAnchor(words, "13c");
  if (!a || !b || !c || !a.bb || !b.bb || !c.bb) return false;
  var vgap = Math.abs(a.yc - c.yc);
  if (vgap < CONFIG.minRowGapPts) return false;               // must be different rows
  if (vgap > CONFIG.maxRowGapPts) return false;               // but not a page apart (prose)
  if (Math.abs(a.xc - c.xc) > CONFIG.colAlignTolPts) return false;  // same left column
  if (b.xc <= a.xc) return false;                             // 13b to the right of 13a
  return true;
}

/* PRIMARY name reader — by position (the box below 13a, left of 13b, above 13c) */
function extractNamePosition(words, dims){
  var a = findAnchor(words, "13a"), b = findAnchor(words, "13b"), c = findAnchor(words, "13c");
  if (!a || !a.bb) return "";
  var yA = a.yc, yB = (b && b.bb) ? b.yc : null, yC = (c && c.bb) ? c.yc : null;
  var y1, y2;
  if (yC !== null){ y1 = Math.min(yA, yC); y2 = Math.max(yA, yC); }
  else { var h = dims.h * CONFIG.boxHeightFraction; y1 = yA - h; y2 = yA + h; }
  var xLeft = a.bb.xmin - CONFIG.padPts, xRight;
  if (b && b.bb && b.xc > a.xc){ xRight = b.bb.xmin - CONFIG.padPts; }
  else { xRight = dims.w * CONFIG.rightColumnFraction; }
  var tol = CONFIG.labelLineTolPts, picks = [], i, w;
  for (i = 0; i < words.length; i++){
    w = words[i];
    if (!w.bb) continue;
    if (w.i === a.i) continue;
    if (b && w.i === b.i) continue;
    if (c && w.i === c.i) continue;
    if (w.text === "") continue;
    if (Math.abs(w.yc - yA) < tol) continue;
    if (yB !== null && Math.abs(w.yc - yB) < tol) continue;
    if (yC !== null && Math.abs(w.yc - yC) < tol) continue;
    if (w.yc <= y1 || w.yc >= y2) continue;
    if (w.xc < xLeft || w.xc > xRight) continue;
    picks.push(w);
  }
  if (!picks.length) return "";
  if (picks.length > CONFIG.maxNameWords) return "";
  picks.sort(function (p1, p2){
    var dy = Math.abs(p1.yc - p2.yc);
    if (dy > 4){ return Math.abs(p1.yc - yA) - Math.abs(p2.yc - yA); }
    return p1.xc - p2.xc;
  });
  var parts = [];
  for (i = 0; i < picks.length; i++) parts.push(picks[i].text);
  return cleanName(parts.join(" "));
}

/* CROSS-CHECK name reader — by reading order (independent method) */
function extractNameReadingOrder(words){
  var a = findAnchor(words, "13a");
  if (!a) return "";
  var skip = { recipients: 1, recipient: 1, name: 1 };
  var stop = { "13b": 1, country: 1 };
  var picked = [], count = 0, i, w, nt, started = false;
  for (i = a.i + 1; i < words.length && count < 12; i++){
    w = words[i]; nt = w.ntext;
    if (stop[nt]) break;
    if (!started && skip[nt]) continue;   // skip only LEADING label words, not a name that contains them
    if (nt === "") continue;
    started = true;
    picked.push(w.text); count++;
  }
  return cleanName(picked.join(" "));
}

/* ---------------------------------------------------------------------
   form-type detection + generic label-anchored name reader (1099 / W-2 / 1042)
   ------------------------------------------------------------------- */
function hasTok(words, tok){ return findAnchor(words, tok) != null; }
function hasTokPrefix(words, pfx){ for (var i = 0; i < words.length; i++){ if (words[i].ntext.indexOf(pfx) === 0) return true; } return false; }

/* find a label made of consecutive tokens on ~one line; returns its bbox + the matched words */
function findLabel(words, seq){
  if (!seq || !seq.length) return null;
  var i, k, j;
  for (i = 0; i < words.length; i++){
    if (words[i].ntext !== seq[0] || !words[i].bb) continue;
    var matched = [words[i]], ref = words[i], ok = true;
    for (k = 1; k < seq.length; k++){
      var best = null, bestdx = 1e9;
      for (j = 0; j < words.length; j++){
        var w = words[j];
        if (w.ntext !== seq[k] || !w.bb || !ref.bb) continue;
        if (Math.abs(w.yc - ref.yc) > CONFIG.labelLineTolPts * 3) continue;
        var dx = w.xc - ref.xc; if (dx <= 0) continue;
        if (dx < bestdx){ bestdx = dx; best = w; }
      }
      if (!best){ ok = false; break; }
      matched.push(best); ref = best;
    }
    if (!ok) continue;
    var xs = [], ys = [], m;
    for (m = 0; m < matched.length; m++){ xs.push(matched[m].bb.xmin, matched[m].bb.xmax); ys.push(matched[m].bb.ymin, matched[m].bb.ymax); }
    return { xmin: Math.min.apply(null, xs), xmax: Math.max.apply(null, xs), ymin: Math.min.apply(null, ys), ymax: Math.max.apply(null, ys),
             xc: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, yc: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, words: matched };
  }
  return null;
}

/* read the value that sits just BELOW a label (PDF space: lower y), in a horizontal band */
function nameBelowLabel(words, dims, label, opt){
  if (!label) return "";
  opt = opt || {};
  var bandH = opt.bandH || 24, bandW = opt.bandW || Math.min(270, dims.w * 0.45);
  var yTop = label.ymin - 1, yBot = label.ymin - bandH, xL = label.xmin - 4, xR = label.xmin + bandW;
  var excl = {}, e, i, w, stop = opt.stop || {};
  for (e = 0; e < label.words.length; e++) excl[label.words[e].i] = 1;
  var picks = [];
  for (i = 0; i < words.length; i++){
    w = words[i];
    if (!w.bb || excl[w.i] || w.text === "") continue;
    if (stop[w.ntext]) continue;
    if (w.yc > yTop || w.yc < yBot) continue;
    if (w.xc < xL || w.xc > xR) continue;
    picks.push(w);
  }
  if (!picks.length) return "";
  if (picks.length > CONFIG.maxNameWords) picks = picks.slice(0, CONFIG.maxNameWords);
  picks.sort(function (a, b){ if (Math.abs(a.yc - b.yc) > 4) return b.yc - a.yc; return a.xc - b.xc; });  // top line first, then left->right
  var parts = []; for (i = 0; i < picks.length; i++) parts.push(picks[i].text);
  return cleanName(parts.join(" "));
}

function is1099(words){ return hasTokPrefix(words, "1099") && hasTok(words, "recipients"); }
function isW2(words){ return (hasTok(words, "wage") && hasTok(words, "statement")) || (hasTokPrefix(words, "w2") && hasTok(words, "employees")); }
function is1042Annual(words){ return hasTok(words, "1042") && hasTok(words, "withholding") && hasTok(words, "agent") && !isFormPage(words); }

/* identify the form type on a page and read its recipient/employee name */
function identifyForm(words, dims){
  if (isFormPage(words)) return { type: "1042-S", name: extractNamePosition(words, dims) };   // 13a/13b/13c box
  if (FORM_CONFIG.enable1099 && is1099(words)) return { type: "1099", name: nameBelowLabel(words, dims, findLabel(words, FORM_CONFIG.label1099), { stop: { street: 1, address: 1, city: 1 } }) };
  if (FORM_CONFIG.enableW2 && isW2(words)) return { type: "W-2", name: nameBelowLabel(words, dims, findLabel(words, FORM_CONFIG.labelW2), {}) };
  if (FORM_CONFIG.enable1042annual && is1042Annual(words)) { var ag = nameBelowLabel(words, dims, findLabel(words, FORM_CONFIG.label1042agent), {}); return { type: "1042", name: ag || FORM_CONFIG.annualGroupName, annual: true }; }
  return { type: null, name: "" };
}

function readPage(doc, p){
  var dims = pageDims(doc, p);
  var words = pageWords(doc, p);
  var f = identifyForm(words, dims);
  var form = (f.type != null);
  var name = f.name || "";
  var alt = (CONFIG.crossCheck && f.type === "1042-S") ? extractNameReadingOrder(words) : "";
  var agree = null;
  if (name && alt) agree = (normTok(name) === normTok(alt));
  return { page: p, form: form, formType: f.type, annual: !!f.annual, name: name, alt: alt, agree: agree, nWords: words.length };
}

/* ---------------------------------------------------------------------
   segmentation — walk every page, build recipient packets (page-list based)
   ------------------------------------------------------------------- */
function detectSegments(doc){
  var n = doc.numPages;
  var segments = [], perPage = [], headerPages = [], reviewPages = [], rotatedPages = [];
  var current = null, suspended = false, p, info, rot;

  for (p = 0; p < n; p++){
    try { rot = doc.getPageRotation(p); if (rot && rot !== 0) rotatedPages.push(p); } catch (e) {}
    info = readPage(doc, p);
    perPage.push(info);

    if (info.form && info.name !== ""){
      suspended = false;
      var ph = isPlaceholderName(info.name);
      if (current === null || ph || current.placeholder || normTok(info.name) !== normTok(current.name)){
        current = { name: info.name, placeholder: ph, pages: [p] };   // new packet
        segments.push(current);
      } else {
        current.pages.push(p);                                        // same recipient continues
      }
    } else if (info.form && info.name === ""){
      info.flag = "FORM_NO_NAME";        // a form we couldn't attribute -> quarantine, don't guess
      suspended = true;
      reviewPages.push(p);
    } else {
      if (suspended) reviewPages.push(p);           // no-name pages after an unreadable form: uncertain
      else if (current) current.pages.push(p);      // instruction page -> current recipient
      else headerPages.push(p);                     // pages before the first named form
    }

    if ((p + 1) % 100 === 0) P("  ...scanned " + (p + 1) + " / " + n + " pages");
  }
  return { segments: segments, perPage: perPage, headerPages: headerPages,
           reviewPages: reviewPages, rotatedPages: rotatedPages, numPages: n };
}

/* group same-named packets (placeholders stay separate), sort alphabetically */
function groupByRecipient(segments){
  var map = {}, order = [], i, j, seg, key, ph = 0;
  for (i = 0; i < segments.length; i++){
    seg = segments[i];
    key = seg.placeholder ? (" ph" + (ph++)) : normTok(seg.name);   // unique key per placeholder packet
    if (!map[key]){ map[key] = { key: key, displayName: seg.name, placeholder: !!seg.placeholder, pages: [], segCount: 0 }; order.push(key); }
    for (j = 0; j < seg.pages.length; j++) map[key].pages.push(seg.pages[j]);
    map[key].segCount++;
  }
  var groups = [];
  for (i = 0; i < order.length; i++){ map[order[i]].pages.sort(function (a, b){ return a - b; }); groups.push(map[order[i]]); }
  groups.sort(function (g1, g2){
    var a = g1.displayName.toLowerCase(), b = g2.displayName.toLowerCase();
    return (a < b) ? -1 : (a > b) ? 1 : 0;
  });
  return groups;
}

/* assign the final, de-duplicated filename to every group (one source of truth) */
function assignFilenames(groups, folder){
  var used = {}, i, base, fname, c;
  for (i = 0; i < groups.length; i++){
    base = safeFilename(groups[i].displayName); if (!base) base = "UNKNOWN";
    fname = base; c = 2;
    while (used[fname.toLowerCase()]){ fname = base + " (" + c + ")"; c++; }
    used[fname.toLowerCase()] = true;
    groups[i].safe = fname;
    groups[i].file = folder + CONFIG.filePrefix + fname + ".pdf";
  }
}

/* ---------------------------------------------------------------------
   name-similarity (Dice bigram) for near-duplicate flagging
   ------------------------------------------------------------------- */
function bigrams(s){ var m = {}, i; s = normTok(s); for (i = 0; i < s.length - 1; i++){ var g = s.substring(i, i + 2); m[g] = (m[g] || 0) + 1; } return m; }
function dice(a, b){
  a = normTok(a); b = normTok(b);
  if (a.length < 2 || b.length < 2) return (a === b) ? 1 : 0;
  var A = bigrams(a), B = bigrams(b), inter = 0, g, na = 0, nb = 0;
  for (g in A){ if (A.hasOwnProperty(g)){ na += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); } }
  for (g in B){ if (B.hasOwnProperty(g)) nb += B[g]; }
  return (2 * inter) / (na + nb);
}

/* ---------------------------------------------------------------------
   VERIFICATION / DOUBLE-CHECK report
   ------------------------------------------------------------------- */
function verify(det, groups){
  var i, j, g;
  var n = det.numPages;
  var formPages = 0, instrPages = 0;
  for (i = 0; i < det.perPage.length; i++){ if (det.perPage[i].form && det.perPage[i].name) formPages++; else instrPages++; }

  var covered = det.headerPages.length + det.reviewPages.length;
  for (i = 0; i < det.segments.length; i++) covered += det.segments[i].pages.length;

  var noName = [], disagree = [], outliers = [], nearDupes = [], multiRun = [];
  for (i = 0; i < det.perPage.length; i++){
    if (det.perPage[i].flag === "FORM_NO_NAME") noName.push(det.perPage[i].page + 1);
    if (det.perPage[i].agree === false) disagree.push(det.perPage[i]);
  }
  var sizes = [];
  for (i = 0; i < groups.length; i++) sizes.push(groups[i].pages.length);
  sizes.sort(function (a, b){ return a - b; });
  var med = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  var outlierThreshold = Math.max(CONFIG.packetOutlierPages, med * 3);   // relative: only genuinely anomalous packets
  for (i = 0; i < groups.length; i++){
    g = groups[i];
    if (g.pages.length > outlierThreshold) outliers.push({ name: g.displayName, size: g.pages.length, first: g.pages[0] + 1 });
    if (!g.placeholder && g.segCount > 1) multiRun.push({ name: g.displayName, runs: g.segCount });
  }
  if (groups.length <= CONFIG.nearDupeMaxNames){
    for (i = 0; i < groups.length; i++) for (j = i + 1; j < groups.length; j++){
      if (groups[i].placeholder || groups[j].placeholder) continue;
      if (normTok(groups[i].displayName) === normTok(groups[j].displayName)) continue;
      var d = dice(groups[i].displayName, groups[j].displayName);
      if (d >= CONFIG.similarNameThreshold) nearDupes.push({ a: groups[i].displayName, b: groups[j].displayName, score: Math.round(d * 100) / 100 });
    }
  }

  var placeholders = 0;
  for (i = 0; i < groups.length; i++) if (groups[i].placeholder) placeholders++;

  /* form-type breakdown (multi-form) */
  var typeCount = {}, typeOrder = [], tt;
  for (i = 0; i < det.perPage.length; i++){ tt = det.perPage[i].formType; if (tt){ if (!typeCount[tt]){ typeCount[tt] = 0; typeOrder.push(tt); } typeCount[tt]++; } }
  var typeStr = []; for (i = 0; i < typeOrder.length; i++) typeStr.push(typeOrder[i] + ": " + typeCount[typeOrder[i]]);

  P("");
  P("==================== VERIFICATION REPORT ====================");
  P("Total pages ................ " + n);
  P("Form pages (with a name) ... " + formPages);
  P("Form types ................. " + (typeStr.length ? typeStr.join(",  ") : "(none detected)"));
  P("No-name pages (instructions) " + instrPages);
  P("Packets (recipient runs) ... " + det.segments.length);
  P("Unique recipient files ..... " + groups.length + (placeholders ? ("  (" + placeholders + " placeholder file(s) kept separate)") : ""));
  P("Pre-form 'header' pages .... " + det.headerPages.length + (det.headerPages.length ? "  <-- REVIEW" : ""));
  P("Unreadable form pages ...... " + det.reviewPages.length + (det.reviewPages.length ? "  <-- REVIEW (quarantined)" : ""));
  P("Rotated pages .............. " + det.rotatedPages.length + (det.rotatedPages.length ? "  <-- may misread; un-rotate/flatten first" : ""));
  P("Packet size (min/med/max) .. " + (sizes.length ? (sizes[0] + " / " + med + " / " + sizes[sizes.length - 1]) : "0 / 0 / 0"));
  P("Coverage check ............. " + covered + " / " + n + "  " + (covered === n ? "OK (no page lost)" : "*** MISMATCH ***"));
  P("");

  P("---- RECIPIENT INDEX (sorted) ----");
  var shown = Math.min(groups.length, CONFIG.indexPrintCap);
  for (i = 0; i < shown; i++){
    g = groups[i];
    var multi = (g.segCount > 1) ? ("  [" + g.segCount + " runs]") : "";
    P("  " + pad(i + 1, 4) + ". " + g.displayName + "  (" + g.pages.length + " pp, first p." + (g.pages[0] + 1) + ")" + multi);
  }
  if (groups.length > shown) P("  ...and " + (groups.length - shown) + " more (use find(\"name\") to look any up)");
  P("");

  var issues = 0;
  P("---- FLAGS / THINGS TO REVIEW ----");
  if (det.headerPages.length){ issues++; P("  * " + det.headerPages.length + " page(s) BEFORE the first named form -> _REVIEW_unmatched_head.pdf"); }
  if (det.reviewPages.length){ issues++; P("  * " + det.reviewPages.length + " unreadable/uncertain page(s) quarantined -> _REVIEW_unreadable_forms.pdf (pages: " + firstFew(det.reviewPages, 30) + ")"); }
  if (det.rotatedPages.length){ issues++; P("  * " + det.rotatedPages.length + " rotated page(s) (names may misread). Un-rotate/flatten and re-run."); }
  if (noName.length){ issues++; P("  * " + noName.length + " page(s) looked like a form but no name was read (pages: " + noName.slice(0, 50).join(", ") + (noName.length > 50 ? ", ..." : "") + ")"); }
  if (disagree.length){ issues++; P("  * " + disagree.length + " page(s) where the two name-readers disagree:");
    for (i = 0; i < disagree.length && i < 40; i++) P("        p." + (disagree[i].page + 1) + ":  position=\"" + disagree[i].name + "\"   reading=\"" + disagree[i].alt + "\"");
    if (disagree.length > 40) P("        ...and " + (disagree.length - 40) + " more");
  }
  if (outliers.length){ issues++; P("  * " + outliers.length + " unusually large packet(s) (> " + outlierThreshold + " pages, ~3x median) — could be a missed split:");
    for (i = 0; i < outliers.length && i < 40; i++) P("        \"" + outliers[i].name + "\"  (" + outliers[i].size + " pp, first p." + outliers[i].first + ")");
  }
  if (multiRun.length){ P("  * " + multiRun.length + " recipient(s) appear in more than one place — grouped by name. If two DIFFERENT entities share a name, they are merged; check TIN:");
    for (i = 0; i < multiRun.length && i < 40; i++) P("        \"" + multiRun[i].name + "\"  (" + multiRun[i].runs + " runs)");
  }
  if (nearDupes.length){ issues++; P("  * " + nearDupes.length + " near-duplicate name pair(s) (possible typo/spacing — NOT merged):");
    for (i = 0; i < nearDupes.length && i < 40; i++) P("        " + nearDupes[i].score + "  \"" + nearDupes[i].a + "\"  vs  \"" + nearDupes[i].b + "\"");
  }
  if (!issues) P("  none — clean.");
  P("");
  P("VERDICT: " + ((issues === 0 && covered === n) ? "PASS" : "REVIEW ITEMS ABOVE"));
  P("============================================================");
  return { issues: issues, coverageOK: (covered === n) };
}
function firstFew(arr, k){ var out = [], i; for (i = 0; i < arr.length && i < k; i++) out.push(arr[i] + 1); return out.join(", ") + (arr.length > k ? ", ..." : ""); }

/* ---------------------------------------------------------------------
   writing output PDFs (all page-list based; never overwrites the source)
   ------------------------------------------------------------------- */
function writeSplit(doc, groups, src){
  var made = 0, failed = {}, i, k, g, ranges, d;
  P("Writing per-recipient files...");
  for (i = 0; i < groups.length; i++){
    g = groups[i];
    if (samePath(g.file, src)){ P("  SKIP (would overwrite source): " + g.file); failed[g.key] = 1; continue; }
    ranges = pagesToRanges(g.pages);
    if (!ranges.length){ failed[g.key] = 1; continue; }
    d = null;
    try {
      doc.extractPages({ nStart: ranges[0].s, nEnd: ranges[0].e, cPath: g.file });
      if (ranges.length > 1){
        d = app.openDoc({ cPath: g.file });
        for (k = 1; k < ranges.length; k++) d.insertPages({ nPage: d.numPages - 1, cPath: src, nStart: ranges[k].s, nEnd: ranges[k].e });
        d.saveAs({ cPath: g.file });
      }
      made++;
      if (made % 25 === 0) P("  ...wrote " + made + " files");
    } catch (e){ failed[g.key] = 1; P("  FAILED " + g.displayName + " : " + e.toString()); }
    finally { if (d){ try { d.closeDoc(true); } catch (e2) {} } }   // never leak the open doc
  }
  P("  per-recipient files written: " + made);
  return failed;
}

function writeCombined(doc, groups, folder, src){
  var outPath = folder + CONFIG.combinedName;
  if (samePath(outPath, src)){ P("Combined SKIPPED (would overwrite source)."); return; }
  var ranges = [], i, k, g, gr, cdoc = null, bad = 0;
  for (i = 0; i < groups.length; i++){ g = groups[i]; gr = pagesToRanges(g.pages); for (k = 0; k < gr.length; k++) ranges.push(gr[k]); }
  if (!ranges.length){ P("Combined: nothing to write."); return; }
  P("Writing combined sorted file: " + outPath);
  try {
    doc.extractPages({ nStart: ranges[0].s, nEnd: ranges[0].e, cPath: outPath });
    cdoc = app.openDoc({ cPath: outPath });
    for (i = 1; i < ranges.length; i++){
      try { cdoc.insertPages({ nPage: cdoc.numPages - 1, cPath: src, nStart: ranges[i].s, nEnd: ranges[i].e }); }
      catch (e){ bad++; P("  combined: skipped range p." + (ranges[i].s + 1) + "-" + (ranges[i].e + 1) + " : " + e.toString()); }
      if (i % 50 === 0) P("  ...merged " + i + " / " + ranges.length + " runs");
    }
    cdoc.saveAs({ cPath: outPath });
    P("  combined file done (" + (ranges.length - bad) + " of " + ranges.length + " runs" + (bad ? (", " + bad + " SKIPPED — see above") : "") + ").");
  } catch (e){ P("  *** combined file FAILED: " + e.toString()); }
  finally { if (cdoc){ try { cdoc.closeDoc(true); } catch (e2) {} } }
}

function writeRangesFile(doc, pages, outPath, src, label){
  if (!pages || !pages.length) return;
  if (samePath(outPath, src)){ P(label + " SKIPPED (would overwrite source)."); return; }
  var ranges = pagesToRanges(pages), i, d = null;
  try {
    doc.extractPages({ nStart: ranges[0].s, nEnd: ranges[0].e, cPath: outPath });
    if (ranges.length > 1){
      d = app.openDoc({ cPath: outPath });
      for (i = 1; i < ranges.length; i++) d.insertPages({ nPage: d.numPages - 1, cPath: src, nStart: ranges[i].s, nEnd: ranges[i].e });
      d.saveAs({ cPath: outPath });
    }
    P("Wrote " + outPath + " (" + pages.length + " pages) — " + label);
  } catch (e){ P(label + " FAILED: " + e.toString()); }
  finally { if (d){ try { d.closeDoc(true); } catch (e2) {} } }
}

/* ---------------------------------------------------------------------
   retrieval index + find()  ("when the customer asks, give them the form")
   ------------------------------------------------------------------- */
var RECIPIENT_INDEX = null;

function buildIndex(groups, filesWritten, failed){
  RECIPIENT_INDEX = [];
  var i, g, ranges, k, rs;
  for (i = 0; i < groups.length; i++){
    g = groups[i];
    ranges = pagesToRanges(g.pages); rs = [];
    for (k = 0; k < ranges.length; k++) rs.push((ranges[k].s + 1) + "-" + (ranges[k].e + 1));
    RECIPIENT_INDEX.push({
      name: g.displayName,
      file: g.file,
      pageCount: g.pages.length,
      ranges: rs.join(", "),
      exists: !!(filesWritten && !(failed && failed[g.key]))
    });
  }
  P("Index ready: " + RECIPIENT_INDEX.length + " recipients.  Use  find(\"name\")");
}

function openByPath(path){
  try { app.openDoc({ cPath: path }); return true; }
  catch (e){ P("  Could not open file (does it exist yet? dry runs don't write files):\n  " + path); return false; }
}

function find(q){
  if (!RECIPIENT_INDEX){ P("No index yet. Run organize() (or rebuildIndex()) first."); return; }
  var nq = normTok(q), i, r, exact = [], subs = [];
  for (i = 0; i < RECIPIENT_INDEX.length; i++){
    r = RECIPIENT_INDEX[i]; var rn = normTok(r.name);
    if (rn === nq) exact.push(r);
    else if (nq.length >= 2 && (rn.indexOf(nq) >= 0 || nq.indexOf(rn) >= 0)) subs.push(r);
  }
  var pool = exact.length ? exact : subs;
  if (!pool.length){
    P("No match for \"" + q + "\". Closest names:");
    var scored = [];
    for (i = 0; i < RECIPIENT_INDEX.length; i++) scored.push({ r: RECIPIENT_INDEX[i], s: dice(q, RECIPIENT_INDEX[i].name) });
    scored.sort(function (a, b){ return b.s - a.s; });
    for (i = 0; i < 5 && i < scored.length; i++) P("   " + Math.round(scored[i].s * 100) + "%  " + scored[i].r.name);
    return;
  }
  if (pool.length === 1){ openMatch(pool[0]); return pool[0]; }
  P(pool.length + " matches for \"" + q + "\":");
  for (i = 0; i < pool.length; i++) P("   [" + i + "] " + pool[i].name + "  (" + pool[i].pageCount + " pp)  " + pool[i].file);
  P("Open one with:  openForm(\"exact name\")");
  return pool;
}

/* open a recipient's file, or explain accurately if it wasn't written */
function openMatch(r){
  P("Match: " + r.name + "  (" + r.pageCount + " pp, pages " + r.ranges + ")");
  if (r.exists){ P("Opening: " + r.file); openByPath(r.file); }
  else P("  No per-recipient file on disk for this one — that happens for a dry run, combine-only mode,\n  or a write that failed/was skipped. The pages above are still in the combined file.");
}

function openForm(name){
  if (!RECIPIENT_INDEX){ P("No index yet. Run organize() first."); return; }
  var nq = normTok(name), i;
  for (i = 0; i < RECIPIENT_INDEX.length; i++){ if (normTok(RECIPIENT_INDEX[i].name) === nq){ openMatch(RECIPIENT_INDEX[i]); return RECIPIENT_INDEX[i]; } }
  P("No exact match for \"" + name + "\". Try  find(\"" + name + "\")");
}

/* print the whole recipient list as CSV — copy it into a .csv and open in Excel.
   A handy manifest: which recipient is in which file, and which pages. */
function csvCell(s){
  s = String(s);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                 // neutralize CSV/Excel formula injection
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function exportIndexCSV(){
  if (!RECIPIENT_INDEX){ P("No index yet. Run organize() (or rebuildIndex()) first."); return; }
  P("---- copy everything between the lines into a file named  index.csv ----");
  P("recipient,pages,page_ranges,file");
  for (var i = 0; i < RECIPIENT_INDEX.length; i++){
    var r = RECIPIENT_INDEX[i];
    P(csvCell(r.name) + "," + r.pageCount + "," + csvCell(r.ranges) + "," + csvCell(r.file));
  }
  P("---- end index.csv ----");
}

function rebuildIndex(){
  var doc = G_DOC;
  if (!doc || !doc.numPages){ P("Open your 1042-S PDF first."); return; }
  if (!doc.path){ P("Save the PDF to disk first (File > Save)."); return; }
  P("Rebuilding index from " + doc.numPages + " pages (no files written)...");
  var det = detectSegments(doc);
  var groups = groupByRecipient(det.segments);
  var folder = (CONFIG.outputFolder && CONFIG.outputFolder.length) ? ensureSlash(CONFIG.outputFolder) : folderOf(doc.path);
  assignFilenames(groups, folder);
  buildIndex(groups, false, {});
}

/* ---------------------------------------------------------------------
   MAIN
   ------------------------------------------------------------------- */
function organize(){
  var doc = G_DOC;
  if (!doc || !doc.numPages){ P("ERROR: no active PDF. Open your 1042-S PDF, make it the front window, then re-paste this script."); return; }
  if (!doc.path){ P("ERROR: this PDF isn't saved to disk. Do File > Save first so the tool knows where to write, then re-run."); return; }

  P("========================================================");
  P("  1042-S ORGANIZER (v2)");
  P("  Pages: " + doc.numPages + "   dryRun=" + CONFIG.dryRun + "   mode=" + CONFIG.mode);
  P("========================================================");

  P("Scanning pages for Box 13a...");
  var det = detectSegments(doc);
  var groups = groupByRecipient(det.segments);

  var folder = (CONFIG.outputFolder && CONFIG.outputFolder.length) ? ensureSlash(CONFIG.outputFolder) : folderOf(doc.path);
  assignFilenames(groups, folder);

  verify(det, groups);
  P("Output folder: " + folder);

  /* preflight: make sure nothing we plan to write equals the source PDF */
  var src = doc.path, i, collide = 0;
  for (i = 0; i < groups.length; i++) if (samePath(groups[i].file, src)) collide++;
  if (samePath(folder + CONFIG.combinedName, src)) collide++;
  if (collide){ P(">>> WARNING: " + collide + " output path(s) collide with your source file name and will be SKIPPED to protect the original. Change CONFIG.filePrefix or CONFIG.outputFolder to write them."); }

  if (CONFIG.dryRun){
    buildIndex(groups, false, {});
    P("");
    P(">>> DRY RUN complete — NO files were written.");
    P(">>> If the report looks right, set  CONFIG.dryRun = false  and run  organize()  again.");
    return;
  }

  var didSplit = (CONFIG.mode === "split" || CONFIG.mode === "both");
  var failed = {};
  if (didSplit) failed = writeSplit(doc, groups, src);
  if (CONFIG.mode === "combine" || CONFIG.mode === "both") writeCombined(doc, groups, folder, src);
  writeRangesFile(doc, det.headerPages, folder + "_REVIEW_unmatched_head.pdf", src, "pages before the first named form");
  writeRangesFile(doc, det.reviewPages, folder + "_REVIEW_unreadable_forms.pdf", src, "unreadable/uncertain form pages");

  buildIndex(groups, didSplit, failed);   // only mark per-recipient files as existing if we actually wrote them

  var nFailed = 0, k; for (k in failed) if (failed.hasOwnProperty(k)) nFailed++;
  P("");
  P(">>> DONE.");
  if (didSplit) P(">>> Recipients: " + groups.length + "   Per-recipient files written: " + (groups.length - nFailed) + (nFailed ? ("   FAILED/SKIPPED: " + nFailed) : ""));
  else P(">>> Recipients: " + groups.length + "   (combine-only mode: wrote just the combined file, no per-recipient files)");
  if (CONFIG.mode === "combine" || CONFIG.mode === "both") P(">>> Combined file: " + folder + CONFIG.combinedName);
  if (didSplit) P(">>> Retrieve a recipient's form with:  find(\"name\")   Manifest: exportIndexCSV()");
  else P(">>> (Per-recipient retrieval via find() needs CONFIG.mode = \"split\" or \"both\".)");
}

/* ---------------------------------------------------------------------
   CALIBRATION helpers — run these first on a sample page (1-based input)
   ------------------------------------------------------------------- */
function testName(humanPage){
  var doc = G_DOC, p = humanPage - 1;
  var r = readPage(doc, p);
  P("Page " + humanPage + ":  form=" + r.form + "  type=" + r.formType + "  words=" + r.nWords);
  P("   name (position) : \"" + r.name + "\"");
  P("   name (reading)  : \"" + r.alt + "\"");
  P("   agree           : " + r.agree);
  return r;
}
/* which form type is this page, and what name did each detector read? (calibration) */
function identifyForm_page(humanPage){
  var doc = G_DOC, p = humanPage - 1, words = pageWords(doc, p), dims = pageDims(doc, p);
  var f = identifyForm(words, dims);
  P("Page " + humanPage + ":  detected form type = " + (f.type || "(not a form)") + (f.annual ? "  [annual/filer]" : ""));
  P("   recipient/name read: \"" + f.name + "\"");
  P("   signatures: 1042-S(13a/b/c)=" + isFormPage(words) + "  1099=" + is1099(words) + "  W-2=" + isW2(words) + "  1042annual=" + is1042Annual(words));
  P("   (if the name is wrong, run dumpWords(" + humanPage + ") and adjust FORM_CONFIG labels)");
  return f;
}
function scan(a, b){
  var doc = G_DOC, p, r;
  if (!a) a = 1; if (!b) b = Math.min(doc.numPages, a + 24);
  P("page | form | name");
  for (p = a; p <= b; p++){
    r = readPage(doc, p - 1);
    P(pad(p, 5) + " |  " + (r.form ? "Y" : ".") + "   | " + (r.name ? r.name : (r.form ? "(FORM, no name!)" : "")));
  }
}
function dumpWords(humanPage){
  var doc = G_DOC, p = humanPage - 1;
  var words = pageWords(doc, p), i, w;
  P("=== page " + humanPage + ": " + words.length + " words  (idx | text | xmin,ymin - xmax,ymax) ===");
  for (i = 0; i < words.length; i++){
    w = words[i];
    var box = w.bb ? (Math.round(w.bb.xmin) + "," + Math.round(w.bb.ymin) + " - " + Math.round(w.bb.xmax) + "," + Math.round(w.bb.ymax)) : "no-bbox";
    P(pad(i, 4) + " | " + w.text + "   [" + box + "]");
  }
}

P("1042-S Organizer (v2) loaded.");
P("Calibrate:  testName(1)   identifyForm_page(1)   scan(1,20)   dumpWords(1)");
P("Multi-form: handles 1042-S + 1099 + W-2 + 1042. Tune FORM_CONFIG labels with your samples.");
P("Run:        organize()      (dry run first; then set CONFIG.dryRun=false)");
P("Retrieve:   find(\"name\")   openForm(\"Exact Name\")");
P("Manifest:   exportIndexCSV()   (a spreadsheet of recipient -> file -> pages)");

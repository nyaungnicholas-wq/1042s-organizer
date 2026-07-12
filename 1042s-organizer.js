/* ===========================================================================

     ORGANIZE 1042-S TAX FORMS  —  paste this whole file into Adobe Acrobat
     (v3 — includes a probe() self-test for "files won't save" problems)

   ⚠ IF ORGANIZE DIDN'T SAVE ANY FILES:  after pasting (STEP 4), type  probe()
     and press Ctrl+Enter. It tells you in 2 seconds whether the problem is the
     folder, the filenames, or the PDF's security — then send me that result.

   ---------------------------------------------------------------------------
   WHAT THIS DOES
     You have ONE big PDF with 1042-S forms for lots of different people, all
     mixed up. This sorts them by the person's name (Box 13a), keeps each form
     together with its instruction page, and saves a clean, separate PDF for
     each person. Your original file is NEVER changed.

   ---------------------------------------------------------------------------
   HOW TO USE IT  —  just follow these steps in order:

     STEP 1.  Open your big PDF in Adobe Acrobat (the paid "Pro" version).

     STEP 2.  Turn on the code box (you only do this once, ever):
                • Windows:  Edit menu  > Preferences > JavaScript
                • Mac:      Acrobat menu > Settings   > JavaScript
              Check BOTH boxes that mention JavaScript, then click OK.

     STEP 3.  Press   Ctrl + J   (Windows)   or   Command + J   (Mac).
              A box opens at the bottom of the screen. That is where code goes.

     STEP 4.  Copy ALL of this file (top to bottom), paste it into that box,
              then press   Ctrl + Enter   to load it.

     STEP 5.  Type this and press Ctrl + Enter:

                   organize()

              It shows you a PREVIEW first and saves NOTHING yet. Read it.

     STEP 6.  If the preview looks right, type these two lines (press
              Ctrl + Enter after each one):

                   CONFIG.dryRun = false
                   organize()

              Your organized PDFs are now saved in the SAME folder as your
              big PDF — one file per person, plus one combined sorted file.

   ---------------------------------------------------------------------------
   TWO WAYS TO GET THE RESULT (pick one, before STEP 6):

     A) SEPARATE FILES (default) — leaves your PDF untouched and writes new,
        sorted PDFs next to it (one per person + one combined). Do nothing extra.

     B) RE-SORT THIS SAME PDF IN PLACE — physically reorders the pages inside
        the PDF you have open, no extra files. Before STEP 6, also run this line:
              CONFIG.mode = "inplace"
        After it finishes, use  File > Save  to keep it (or close WITHOUT saving
        to undo — your file on disk isn't changed until you Save).

   TO FIND ONE PERSON'S FORM LATER (mode A only):  type  find("their name")

   In mode A nothing changes your original PDF. In mode B the change stays only
   in the open window until YOU choose File > Save.
   =========================================================================== */

var G_DOC = this;

var CONFIG = {

  dryRun: true,
  mode: "both",

  outputFolder: "",
  filePrefix: "1042S_",
  combinedName: "_ORGANIZED_1042S_sorted.pdf",

  crossCheck: true,
  maxNameWords: 10,
  padPts: 2,
  rightColumnFraction: 0.62,
  boxHeightFraction: 0.06,
  minRowGapPts: 6,
  maxRowGapPts: 140,
  colAlignTolPts: 45,
  labelLineTolPts: 3,

  packetOutlierPages: 8,
  similarNameThreshold: 0.86,
  nearDupeMaxNames: 1500,
  indexPrintCap: 25          // Acrobat's console buffer is small; the full list is in exportIndexCSV()
};

var PLACEHOLDER_KEYS = { "unknownrecipient": 1, "unknown": 1, "withholdingratepool": 1, "withholdingratepoolgeneral": 1 };

var FORM_CONFIG = {
  enable1099: true,
  enableW2: true,
  enable1042annual: true,
  label1099: ["recipients", "name"],
  labelW2: ["employees", "first"],
  label1042agent: ["name", "of", "withholding", "agent"],
  annualGroupName: "1042 Annual Return (filer)"
};

function P(s){ try { console.println(String(s)); } catch (e) {} }

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

function safeFilename(s){
  if (s === null || s === undefined) return "";
  s = String(s);
  s = s.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  s = s.replace(/[\\\/:\*\?"<>\|]/g, " ");
  s = collapse(trim(s));
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  s = s.replace(/\.{2,}/g, ".");
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  var stem = s.split(".")[0];
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) s = "_" + s;
  if (s.length > 120) s = trim(s.substring(0, 120));
  s = s.replace(/[.\s]+$/g, "");
  return s;
}

function folderOf(path){ return String(path).replace(/[^\/]+$/, ""); }
function ensureSlash(p){ p = String(p); return (p.charAt(p.length - 1) === "/") ? p : (p + "/"); }

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

/* Some Acrobat builds reject the object-literal call form for the page/file
   methods with "RangeError: Invalid argument value" and only accept the
   classic positional signatures. Try the object form first, then fall back. */
function xExtract(doc, s, e, path){
  try { doc.extractPages({ nStart: s, nEnd: e, cPath: path }); return; } catch (e1) {}
  try { doc.extractPages(s, e, path); return; } catch (e2) {}
  /* last resort: extract to a new window, save that, close it */
  var nd = doc.extractPages(s, e);
  if (!nd) throw new Error("extractPages refused (document security may forbid page extraction)");
  try { xSaveAs(nd, path); } finally { try { nd.closeDoc(true); } catch (e3) {} }
}
function xInsert(d, afterPage, srcPath, s, e){
  try { d.insertPages({ nPage: afterPage, cPath: srcPath, nStart: s, nEnd: e }); }
  catch (err){ d.insertPages(afterPage, srcPath, s, e); }
}
function xSaveAs(d, path){
  try { d.saveAs({ cPath: path }); }
  catch (err){ d.saveAs(path); }
}
function xOpen(path){
  try { return app.openDoc({ cPath: path }); }
  catch (err){ return app.openDoc(path); }
}
function pad(n, w){ var s = String(n); while (s.length < w) s = " " + s; return s; }

/* Given the desired final page order (a permutation of 0..n-1 by ORIGINAL index),
   return the sequence of {from, after} movePage operations that, applied in order,
   physically rearrange the document into that order. `after` is the page index to
   move behind; -1 means move to the very front. Pure + fully testable. */
function reorderPlan(order){
  var n = order.length, cur = [], i, j, ops = [], fromPos, val;
  for (i = 0; i < n; i++) cur.push(i);
  for (i = 0; i < n; i++){
    fromPos = -1;
    for (j = i; j < n; j++){ if (cur[j] === order[i]){ fromPos = j; break; } }
    if (fromPos < 0 || fromPos === i) continue;
    ops.push({ from: fromPos, after: i - 1 });
    val = cur.splice(fromPos, 1)[0];
    cur.splice(i, 0, val);
  }
  return ops;
}

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

function pageWordsTextOnly(doc, p){
  var out = [], n = 0, i, t;
  try { n = doc.getPageNumWords(p); } catch (e) { return out; }
  for (i = 0; i < n; i++){
    t = "";
    try { t = doc.getPageNthWord(p, i, true); } catch (e2) { t = ""; }
    if (t === null || t === undefined) t = "";
    out.push({ i: i, text: t, ntext: normTok(t), bb: null, xc: 0, yc: 0 });
  }
  return out;
}

/* superset of every form classifier's required anchor tokens (see is1099/isW2/
   is1042Annual/isFormPage). If none of these are present as plain text, the page
   cannot be any recognized form, so we skip it WITHOUT the expensive per-word
   coordinate lookup (getPageNthWordQuads) below — this is what makes organize()
   fast on a large document: prose/instruction pages (about half of a real file)
   are ruled out on cheap text alone. */
function mightBeAnyForm(cheap){
  if (hasTok(cheap, "13a")) return true;
  if (FORM_CONFIG.enable1099 && hasTokPrefix(cheap, "1099") && hasTok(cheap, "recipients")) return true;
  if (FORM_CONFIG.enableW2 && ((hasTok(cheap, "wage") && hasTok(cheap, "statement")) || (hasTokPrefix(cheap, "w2") && hasTok(cheap, "employees")))) return true;
  if (FORM_CONFIG.enable1042annual && hasTok(cheap, "1042") && hasTok(cheap, "withholding") && hasTok(cheap, "agent")) return true;
  return false;
}

function findAnchor(words, tok){
  for (var i = 0; i < words.length; i++){ if (words[i].ntext === tok) return words[i]; }
  return null;
}

/* the 13a/13b/13c recipient-box geometry rule, shared by isFormPage and the
   cheap 3-word probe below so the two can never disagree */
function anchorsFormBox(a, b, c){
  if (!a || !b || !c || !a.bb || !b.bb || !c.bb) return false;
  var vgap = Math.abs(a.yc - c.yc);
  if (vgap < CONFIG.minRowGapPts) return false;
  if (vgap > CONFIG.maxRowGapPts) return false;
  if (Math.abs(a.xc - c.xc) > CONFIG.colAlignTolPts) return false;
  if (b.xc <= a.xc) return false;
  return true;
}

function isFormPage(words){
  return anchorsFormBox(findAnchor(words, "13a"), findAnchor(words, "13b"), findAnchor(words, "13c"));
}

function fillQuad(doc, p, w){
  var bb = null;
  try { bb = bboxFromQuads(doc.getPageNthWordQuads(p, w.i)); } catch (e) { bb = null; }
  w.bb = bb;
  if (bb){ w.xc = (bb.xmin + bb.xmax) / 2; w.yc = (bb.ymin + bb.ymax) / 2; }
  return w;
}

/* real IRS instruction pages MENTION "13a" in prose, so token presence alone
   can't rule them out. Probe: fetch coordinates for just the FIRST 13a/13b/13c
   words (3 calls) and apply the same geometry rule isFormPage uses. Only when
   that box shape is really there (or another form type text-matches) do we pay
   for the whole page's coordinates. */
function pageWords(doc, p){
  var cheap = pageWordsTextOnly(doc, p);
  var other = (FORM_CONFIG.enable1099 && hasTokPrefix(cheap, "1099") && hasTok(cheap, "recipients")) ||
              (FORM_CONFIG.enableW2 && ((hasTok(cheap, "wage") && hasTok(cheap, "statement")) || (hasTokPrefix(cheap, "w2") && hasTok(cheap, "employees")))) ||
              (FORM_CONFIG.enable1042annual && hasTok(cheap, "1042") && hasTok(cheap, "withholding") && hasTok(cheap, "agent"));
  var has13a = hasTok(cheap, "13a");
  if (!has13a && !other) return cheap;                    // plain prose: zero coordinate calls
  if (has13a && !other){
    var a = findAnchor(cheap, "13a"), b = findAnchor(cheap, "13b"), c = findAnchor(cheap, "13c");
    if (!b || !c) return cheap;                           // mentions 13a but lacks the box labels
    fillQuad(doc, p, a); fillQuad(doc, p, b); fillQuad(doc, p, c);
    if (!anchorsFormBox(a, b, c)) return cheap;           // prose mention: 3 calls instead of ~350
  }
  var out = [], i;
  for (i = 0; i < cheap.length; i++) out.push(fillQuad(doc, p, { i: cheap[i].i, text: cheap[i].text, ntext: cheap[i].ntext, bb: null, xc: 0, yc: 0 }));
  return out;
}

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

function extractNameReadingOrder(words){
  var a = findAnchor(words, "13a");
  if (!a) return "";
  var skip = { recipients: 1, recipient: 1, name: 1 };
  var stop = { "13b": 1, country: 1 };
  var picked = [], count = 0, i, w, nt, started = false;
  for (i = a.i + 1; i < words.length && count < 12; i++){
    w = words[i]; nt = w.ntext;
    if (stop[nt]) break;
    if (!started && skip[nt]) continue;
    if (nt === "") continue;
    started = true;
    picked.push(w.text); count++;
  }
  return cleanName(picked.join(" "));
}

function hasTok(words, tok){ return findAnchor(words, tok) != null; }
function hasTokPrefix(words, pfx){ for (var i = 0; i < words.length; i++){ if (words[i].ntext.indexOf(pfx) === 0) return true; } return false; }

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
  picks.sort(function (a, b){ if (Math.abs(a.yc - b.yc) > 4) return b.yc - a.yc; return a.xc - b.xc; });
  var parts = []; for (i = 0; i < picks.length; i++) parts.push(picks[i].text);
  return cleanName(parts.join(" "));
}

function is1099(words){ return hasTokPrefix(words, "1099") && hasTok(words, "recipients"); }
function isW2(words){ return (hasTok(words, "wage") && hasTok(words, "statement")) || (hasTokPrefix(words, "w2") && hasTok(words, "employees")); }
function is1042Annual(words){ return hasTok(words, "1042") && hasTok(words, "withholding") && hasTok(words, "agent") && !isFormPage(words); }

function identifyForm(words, dims){
  if (isFormPage(words)) return { type: "1042-S", name: extractNamePosition(words, dims) };
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

function newScanState(n){
  return { segments: [], perPage: [], headerPages: [], reviewPages: [], rotatedPages: [],
           current: null, suspended: false, numPages: n };
}

/* process exactly one page into the scan state (shared by the synchronous
   detectSegments and the chunked, non-freezing runner used in Acrobat) */
function scanStep(doc, S, p){
  var rot, info;
  try { rot = doc.getPageRotation(p); if (rot && rot !== 0) S.rotatedPages.push(p); } catch (e) {}
  info = readPage(doc, p);
  S.perPage.push(info);
  if (info.form && info.name !== ""){
    S.suspended = false;
    var ph = isPlaceholderName(info.name);
    if (S.current === null || ph || S.current.placeholder || normTok(info.name) !== normTok(S.current.name)){
      S.current = { name: info.name, placeholder: ph, pages: [p] };
      S.segments.push(S.current);
    } else {
      S.current.pages.push(p);
    }
  } else if (info.form && info.name === ""){
    info.flag = "FORM_NO_NAME";
    S.suspended = true;
    S.reviewPages.push(p);
  } else {
    if (S.suspended) S.reviewPages.push(p);
    else if (S.current) S.current.pages.push(p);
    else S.headerPages.push(p);
  }
}

function scanResult(S){
  return { segments: S.segments, perPage: S.perPage, headerPages: S.headerPages,
           reviewPages: S.reviewPages, rotatedPages: S.rotatedPages, numPages: S.numPages };
}

function detectSegments(doc){
  var n = doc.numPages, S = newScanState(n), p;
  for (p = 0; p < n; p++){
    scanStep(doc, S, p);
    if ((p + 1) % 100 === 0) P("  ...scanned " + (p + 1) + " / " + n + " pages");
  }
  return scanResult(S);
}

function groupByRecipient(segments){
  var map = {}, order = [], i, j, seg, key, ph = 0;
  for (i = 0; i < segments.length; i++){
    seg = segments[i];
    key = seg.placeholder ? (" ph" + (ph++)) : normTok(seg.name);
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

function bigrams(s){ var m = {}, i; s = normTok(s); for (i = 0; i < s.length - 1; i++){ var g = s.substring(i, i + 2); m[g] = (m[g] || 0) + 1; } return m; }
function dice(a, b){
  a = normTok(a); b = normTok(b);
  if (a.length < 2 || b.length < 2) return (a === b) ? 1 : 0;
  var A = bigrams(a), B = bigrams(b), inter = 0, g, na = 0, nb = 0;
  for (g in A){ if (A.hasOwnProperty(g)){ na += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); } }
  for (g in B){ if (B.hasOwnProperty(g)) nb += B[g]; }
  return (2 * inter) / (na + nb);
}

/* bigram profile per name, computed ONCE — the pairwise near-dupe loop is
   O(n^2) and rebuilding bigrams inside it froze Acrobat at ~400 names */
function nearDupeProfiles(groups){
  var prof = [], i, pk;
  for (i = 0; i < groups.length; i++){
    var nt = normTok(groups[i].displayName);
    var bg = bigrams(nt), tot = 0;
    for (pk in bg){ if (bg.hasOwnProperty(pk)) tot += bg[pk]; }
    prof.push({ nt: nt, bg: bg, tot: tot });
  }
  return prof;
}

/* compare rows i0..i1 (exclusive) against all later names; append hits to out.
   Row-ranged so the async runner can spread the scan across ticks. */
function nearDupeRows(groups, prof, i0, i1, out){
  var i, j, pg2;
  for (i = i0; i < i1; i++) for (j = i + 1; j < groups.length; j++){
    if (groups[i].placeholder || groups[j].placeholder) continue;
    if (prof[i].nt === prof[j].nt) continue;
    if (prof[i].nt.length < 2 || prof[j].nt.length < 2) continue;
    var inter = 0;
    for (pg2 in prof[i].bg){ if (prof[i].bg.hasOwnProperty(pg2) && prof[j].bg[pg2]) inter += Math.min(prof[i].bg[pg2], prof[j].bg[pg2]); }
    var d = (2 * inter) / (prof[i].tot + prof[j].tot);
    if (d >= CONFIG.similarNameThreshold) out.push({ a: groups[i].displayName, b: groups[j].displayName, score: Math.round(d * 100) / 100 });
  }
}

function verify(det, groups, preDupes){
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
  var outlierThreshold = Math.max(CONFIG.packetOutlierPages, med * 3);
  for (i = 0; i < groups.length; i++){
    g = groups[i];
    if (g.pages.length > outlierThreshold) outliers.push({ name: g.displayName, size: g.pages.length, first: g.pages[0] + 1 });
    if (!g.placeholder && g.segCount > 1) multiRun.push({ name: g.displayName, runs: g.segCount });
  }
  if (preDupes) nearDupes = preDupes;                       // computed in chunks by the async runner
  else if (groups.length <= CONFIG.nearDupeMaxNames){
    var prof = nearDupeProfiles(groups);
    nearDupeRows(groups, prof, 0, groups.length, nearDupes);
  }

  var placeholders = 0;
  for (i = 0; i < groups.length; i++) if (groups[i].placeholder) placeholders++;

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

/* write ONE recipient's PDF; returns true on success. Shared by the synchronous
   writeSplit (tested) and the chunked runner (Acrobat). */
function writeOneGroup(doc, g, src){
  if (samePath(g.file, src)){ P("  SKIP (would overwrite source): " + g.file); return false; }
  var ranges = pagesToRanges(g.pages);
  if (!ranges.length) return false;
  var d = null, ok = false, k;
  try {
    xExtract(doc, ranges[0].s, ranges[0].e, g.file);
    if (ranges.length > 1){
      d = xOpen(g.file);
      for (k = 1; k < ranges.length; k++) xInsert(d, d.numPages - 1, src, ranges[k].s, ranges[k].e);
      xSaveAs(d, g.file);
    }
    ok = true;
  } catch (e){ P("  FAILED " + g.displayName + " : " + e.toString()); ok = false; }
  finally { if (d){ try { d.closeDoc(true); } catch (e2) {} } }
  return ok;
}

function writeSplit(doc, groups, src){
  var made = 0, failed = {}, i;
  P("Writing per-recipient files...");
  for (i = 0; i < groups.length; i++){
    if (writeOneGroup(doc, groups[i], src)){ made++; if (made % 25 === 0) P("  ...wrote " + made + " files"); }
    else failed[groups[i].key] = 1;
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
    xExtract(doc, ranges[0].s, ranges[0].e, outPath);
    cdoc = xOpen(outPath);
    for (i = 1; i < ranges.length; i++){
      try { xInsert(cdoc, cdoc.numPages - 1, src, ranges[i].s, ranges[i].e); }
      catch (e){ bad++; P("  combined: skipped range p." + (ranges[i].s + 1) + "-" + (ranges[i].e + 1) + " : " + e.toString()); }
      if (i % 50 === 0) P("  ...merged " + i + " / " + ranges.length + " runs");
    }
    xSaveAs(cdoc, outPath);
    P("  combined file done (" + (ranges.length - bad) + " of " + ranges.length + " runs" + (bad ? (", " + bad + " SKIPPED — see above") : "") + ").");
  } catch (e){ P("  *** combined file FAILED: " + e.toString()); }
  finally { if (cdoc){ try { cdoc.closeDoc(true); } catch (e2) {} } }
}

function writeRangesFile(doc, pages, outPath, src, label){
  if (!pages || !pages.length) return;
  if (samePath(outPath, src)){ P(label + " SKIPPED (would overwrite source)."); return; }
  var ranges = pagesToRanges(pages), i, d = null;
  try {
    xExtract(doc, ranges[0].s, ranges[0].e, outPath);
    if (ranges.length > 1){
      d = xOpen(outPath);
      for (i = 1; i < ranges.length; i++) xInsert(d, d.numPages - 1, src, ranges[i].s, ranges[i].e);
      xSaveAs(d, outPath);
    }
    P("Wrote " + outPath + " (" + pages.length + " pages) — " + label);
  } catch (e){ P(label + " FAILED: " + e.toString()); }
  finally { if (d){ try { d.closeDoc(true); } catch (e2) {} } }
}

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
  try { xOpen(path); return true; }
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

function csvCell(s){
  s = String(s);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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

/* ---------------------------------------------------------------------------
   organize() runs in small CHUNKS that yield control back to Acrobat between
   batches (via app.setTimeOut), so a 1,000+ page file never freezes / shows
   "not responding". If app.setTimeOut isn't available it falls back to running
   straight through, so it is never worse than a plain synchronous run.
   State lives in the global _RUN so it survives across the scheduled callbacks.
   --------------------------------------------------------------------------- */
var _RUN = null;
var _SCAN_CACHE = null;   // remembers the last scan so a repeat run (preview -> real) skips re-reading
var SCAN_CHUNK = 5;       // pages read per batch (small = stays responsive, never "not responding")
var WRITE_CHUNK = 3;      // per-recipient files written per batch
var COMBINE_CHUNK = 25;   // page-ranges merged into the combined file per batch
var DUPE_ROWS = 25;       // near-duplicate-name rows compared per batch
var MOVE_CHUNK = 20;      // page moves per batch when reordering in place

function _asyncAvail(){ try { return !!(app && app.setTimeOut); } catch (e){ return false; } }
function _next(expr, fn){
  if (_RUN && _RUN.async){ try { _RUN.timer = app.setTimeOut(expr, 1); return; } catch (e){} }
  fn();
}

function organize(){
  var doc = G_DOC;
  if (!doc || !doc.numPages){ P("ERROR: no active PDF. Open your PDF, make it the front window, then re-paste this script."); return; }
  if (!doc.path){ P("ERROR: this PDF isn't saved to disk. Do File > Save first, then run organize() again."); return; }

  try { console.clear(); } catch (e) {}   // Acrobat's console buffer is tiny; start each run empty
  P("========================================================");
  P("  1042-S ORGANIZER");
  P("  Pages: " + doc.numPages + "   dryRun=" + CONFIG.dryRun + "   mode=" + CONFIG.mode);
  P("========================================================");

  /* the #1 real-world blocker: the PDF's own security settings */
  var sec = null; try { sec = doc.securityHandler; } catch (eSec) {}
  if (sec) P("NOTE: this PDF is SECURED (" + sec + "). If File > Properties > Security shows\n      'Page Extraction: Not Allowed', Acrobat will refuse to split it into files.");

  /* on a real file-writing run, prove we CAN write ONE page BEFORE scanning
     1,000+ pages — so a blocked document fails in 2 seconds with the true
     reason instead of 108 failures after a long scan. */
  if (!CONFIG.dryRun && CONFIG.mode !== "inplace"){
    var tFolder = (CONFIG.outputFolder && CONFIG.outputFolder.length) ? ensureSlash(CONFIG.outputFolder) : folderOf(doc.path);
    var tPath = tFolder + "_TEST_DELETE_ME.pdf";
    try {
      xExtract(doc, 0, 0, tPath);
      P("Write self-test OK (made " + tPath + " — you can delete it).");
    } catch (eTest){
      P("");
      P("*** STOPPING BEFORE THE SCAN: Acrobat refused a simple 1-page write.");
      P("*** Error: " + eTest.toString());
      P("*** Most common causes:");
      P("***   1) The PDF is SECURED against page extraction.");
      P("***      Check: File > Properties > Security tab > 'Page Extraction'.");
      P("***      If it says 'Not Allowed', no script can split it — you need the");
      P("***      unlocked original (or the permissions password) from whoever made it.");
      P("***   2) Acrobat can't write to this folder — try moving the PDF to a new");
      P("***      folder like C:\\1042s\\ and running again.");
      P("*** ALTERNATIVE that avoids file-writing entirely: reorder THIS open PDF");
      P("*** in place —  CONFIG.mode = \"inplace\"  then  organize()  (then File > Save).");
      return;
    }
  }

  _RUN = {
    doc: doc, src: doc.path, n: doc.numPages, p: 0,
    S: newScanState(doc.numPages),
    folder: (CONFIG.outputFolder && CONFIG.outputFolder.length) ? ensureSlash(CONFIG.outputFolder) : folderOf(doc.path),
    async: _asyncAvail()
  };
  if (_SCAN_CACHE && _SCAN_CACHE.path === _RUN.src && _SCAN_CACHE.n === _RUN.n){
    P("Reusing the scan from your preview (no need to re-read the pages)...");
    _RUN.det = _SCAN_CACHE.det;
    _afterScanData();
    return;
  }
  P("Reading " + _RUN.n + " pages... progress shows below. Acrobat stays usable — please DON'T force-quit.");
  _scanTick();
}

function _scanTick(){
  var R = _RUN; if (!R) return;
  var end = Math.min(R.p + SCAN_CHUNK, R.n);
  for (; R.p < end; R.p++) scanStep(R.doc, R.S, R.p);
  if (R.p % 100 === 0 || R.p === R.n) P("  read " + R.p + " / " + R.n + " pages");
  if (R.p < R.n) _next("_scanTick()", _scanTick);
  else _scanDone();
}

function _scanDone(){
  var R = _RUN;
  R.det = scanResult(R.S);
  _SCAN_CACHE = { path: R.src, n: R.n, det: R.det };   // remember it so a 2nd run needn't re-read
  _afterScanData();
}

/* everything after the (possibly cached) page read: group, name-check, report */
function _afterScanData(){
  var R = _RUN;
  R.groups = groupByRecipient(R.det.segments);
  assignFilenames(R.groups, R.folder);
  R.dupes = [];
  if (R.groups.length <= CONFIG.nearDupeMaxNames && R.groups.length > 1){
    R.prof = nearDupeProfiles(R.groups);
    R.di = 0;
    P("Checking " + R.groups.length + " names for near-duplicates...");
    _dupeTick();
  } else _reportDone();
}

function _dupeTick(){
  var R = _RUN; if (!R) return;
  var end = Math.min(R.di + DUPE_ROWS, R.groups.length);
  nearDupeRows(R.groups, R.prof, R.di, end, R.dupes);
  R.di = end;
  if (R.di < R.groups.length) _next("_dupeTick()", _dupeTick);
  else { R.prof = null; _reportDone(); }
}

function _reportDone(){
  var R = _RUN;
  verify(R.det, R.groups, R.dupes);
  var inplace = (CONFIG.mode === "inplace");

  if (CONFIG.dryRun){
    buildIndex(R.groups, false, {});
    P("");
    P(">>> PREVIEW complete — NOTHING has changed yet.");
    if (inplace) P(">>> To reorder the pages INSIDE this open PDF: set  CONFIG.dryRun = false  then run  organize()  again.");
    else P(">>> If it looks right: set  CONFIG.dryRun = false  then run  organize()  again.");
    _RUN = null;
    return;
  }

  if (inplace){
    var ord = [], gi, pi;
    for (gi = 0; gi < R.groups.length; gi++) for (pi = 0; pi < R.groups[gi].pages.length; pi++) ord.push(R.groups[gi].pages[pi]);
    for (pi = 0; pi < R.det.headerPages.length; pi++) ord.push(R.det.headerPages[pi]);
    for (pi = 0; pi < R.det.reviewPages.length; pi++) ord.push(R.det.reviewPages[pi]);
    R.ops = reorderPlan(ord);
    R.oi = 0;
    P("Reordering the pages inside THIS PDF (" + R.ops.length + " moves)... progress below.");
    _moveTick();
    return;
  }

  var i, collide = 0;
  for (i = 0; i < R.groups.length; i++) if (samePath(R.groups[i].file, R.src)) collide++;
  if (samePath(R.folder + CONFIG.combinedName, R.src)) collide++;
  if (collide) P(">>> WARNING: " + collide + " output path(s) match your source file name and will be SKIPPED to protect the original.");
  P("Output folder: " + R.folder);

  R.didSplit = (CONFIG.mode === "split" || CONFIG.mode === "both");
  R.failed = {};
  R.gi = 0;
  if (R.didSplit){ P("Saving one PDF per recipient..."); _writeTick(); }
  else _afterSplit();
}

function _moveTick(){
  var R = _RUN; if (!R) return;
  var end = Math.min(R.oi + MOVE_CHUNK, R.ops.length), op;
  if (R.mfail === undefined) R.mfail = 0;
  for (; R.oi < end; R.oi++){
    op = R.ops[R.oi];
    try { R.doc.movePage(op.from, op.after); }
    catch (e){ R.mfail++; if (R.mfail === 1) P("  *** movePage refused: " + e.toString()); }
  }
  if (R.oi % 100 === 0 || R.oi === R.ops.length) P("  moved " + R.oi + " / " + R.ops.length + " pages");
  if (R.oi < R.ops.length) _next("_moveTick()", _moveTick);
  else {
    _SCAN_CACHE = null;   // pages physically moved — the old scan no longer matches
    P("");
    if (R.mfail){
      P(">>> " + R.mfail + " of " + R.ops.length + " page moves were REFUSED — the PDF is probably secured");
      P(">>> (File > Properties > Security: 'Document Assembly: Not Allowed').");
      P(">>> Close WITHOUT saving; a partially-moved file is worse than the original.");
      P(">>> You need the unlocked original (or the permissions password) from the issuer.");
    } else {
      P(">>> DONE — the pages in THIS open PDF are now sorted (grouped by name, A to Z, each form with its instruction page).");
      P(">>> Review it, then use  File > Save  to keep the new order.");
      P(">>> To UNDO: close the file WITHOUT saving (or File > Revert). Your file on disk is unchanged until you Save.");
    }
    _RUN = null;
  }
}

function _writeTick(){
  var R = _RUN; if (!R) return;
  var end = Math.min(R.gi + WRITE_CHUNK, R.groups.length);
  for (; R.gi < end; R.gi++){ if (!writeOneGroup(R.doc, R.groups[R.gi], R.src)) R.failed[R.groups[R.gi].key] = 1; }
  if (R.gi % 25 === 0 || R.gi === R.groups.length) P("  saved " + R.gi + " / " + R.groups.length + " recipient files");
  if (R.gi < R.groups.length) _next("_writeTick()", _writeTick);
  else _afterSplit();
}

function _afterSplit(){
  var R = _RUN;
  if (CONFIG.mode === "combine" || CONFIG.mode === "both"){
    R.combPath = R.folder + CONFIG.combinedName;
    if (samePath(R.combPath, R.src)){ P("Combined SKIPPED (would overwrite source)."); _afterCombine(); return; }
    R.cranges = []; var i, k, gr;
    for (i = 0; i < R.groups.length; i++){ gr = pagesToRanges(R.groups[i].pages); for (k = 0; k < gr.length; k++) R.cranges.push(gr[k]); }
    if (!R.cranges.length){ _afterCombine(); return; }
    P("Building the combined sorted file (" + R.cranges.length + " sections)...");
    try {
      xExtract(R.doc, R.cranges[0].s, R.cranges[0].e, R.combPath);
      R.cdoc = xOpen(R.combPath);
      R.ci = 1; R.cbad = 0;
      _combineTick();
    } catch (e){ P("  *** combined file FAILED to start: " + e.toString()); if (R.cdoc){ try { R.cdoc.closeDoc(true); } catch (e2) {} } R.cdoc = null; _afterCombine(); }
  } else _afterCombine();
}

function _combineTick(){
  var R = _RUN; if (!R) return;
  var end = Math.min(R.ci + COMBINE_CHUNK, R.cranges.length);
  for (; R.ci < end; R.ci++){
    try { xInsert(R.cdoc, R.cdoc.numPages - 1, R.src, R.cranges[R.ci].s, R.cranges[R.ci].e); }
    catch (e){ R.cbad++; }
  }
  P("  merged " + R.ci + " / " + R.cranges.length + " sections");
  if (R.ci < R.cranges.length) _next("_combineTick()", _combineTick);
  else {
    try { xSaveAs(R.cdoc, R.combPath); P("  combined file done (" + (R.cranges.length - R.cbad) + " of " + R.cranges.length + " sections" + (R.cbad ? (", " + R.cbad + " skipped") : "") + ")."); }
    catch (e){ P("  *** combined save FAILED: " + e.toString()); }
    finally { if (R.cdoc){ try { R.cdoc.closeDoc(true); } catch (e2) {} } R.cdoc = null; }
    _afterCombine();
  }
}

function _afterCombine(){
  var R = _RUN;
  writeRangesFile(R.doc, R.det.headerPages, R.folder + "_REVIEW_unmatched_head.pdf", R.src, "pages before the first named form");
  writeRangesFile(R.doc, R.det.reviewPages, R.folder + "_REVIEW_unreadable_forms.pdf", R.src, "unreadable/uncertain form pages");
  buildIndex(R.groups, R.didSplit, R.failed);

  var nFailed = 0, k; for (k in R.failed) if (R.failed.hasOwnProperty(k)) nFailed++;
  P("");
  P(">>> DONE.");
  if (R.didSplit) P(">>> Recipients: " + R.groups.length + "   Per-recipient files written: " + (R.groups.length - nFailed) + (nFailed ? ("   FAILED/SKIPPED: " + nFailed) : ""));
  else P(">>> Recipients: " + R.groups.length + "   (combine-only mode: wrote just the combined file, no per-recipient files)");
  if (CONFIG.mode === "combine" || CONFIG.mode === "both") P(">>> Combined file: " + R.folder + CONFIG.combinedName);
  if (R.didSplit) P(">>> Retrieve a recipient's form with:  find(\"name\")   Manifest: exportIndexCSV()");
  _RUN = null;
}

function testName(humanPage){
  var doc = G_DOC, p = humanPage - 1;
  var r = readPage(doc, p);
  P("Page " + humanPage + ":  form=" + r.form + "  type=" + r.formType + "  words=" + r.nWords);
  P("   name (position) : \"" + r.name + "\"");
  P("   name (reading)  : \"" + r.alt + "\"");
  P("   agree           : " + r.agree);
  return r;
}

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

/* WRITE PROBE — if organize() fails to save files, run  probe()  to find out WHY.
   It tries writing a 1-page test file to your folder (clean name + a name with
   spaces) and tells you plainly whether it's the folder, the filenames, or the
   PDF's security. No hand-typed paths needed. */
function probe(){
  var d = G_DOC;
  if (!d || !d.numPages){ P("Open your PDF and make it the front window first."); return; }
  if (!d.path){ P("Save the PDF to disk first (File > Save), then run probe()."); return; }
  try { console.clear(); } catch (e) {}
  P("=================== WRITE PROBE ===================");
  try { P("PDF secured?  " + d.securityHandler); } catch (e) { P("PDF secured?  (unknown)"); }
  var folder = folderOf(d.path);
  P("Folder:       " + folder);
  function t(label, path){
    try { xExtract(d, 0, 0, path); P(label + ": OK"); return true; }
    catch (e){ P(label + ": FAILED  ->  " + e.toString()); return false; }
  }
  var a = t("clean filename ", folder + "_probe1.pdf");
  var b = t("filename w/space", folder + "_probe with spaces.pdf");
  P("------------------- VERDICT -------------------");
  if (a && b) P("Writing WORKS here. organize() should save files. If it still fails, send me the console.");
  else if (a && !b) P("It's the SPACES in recipient names. Tell me and I'll switch output names to underscores.");
  else if (String(d.securityHandler) !== "null" && String(d.securityHandler) !== "undefined") P("The PDF is SECURED and blocking writes. Check File > Properties > Security > Page Extraction. You need the unlocked original. (Or try  CONFIG.mode = \"inplace\".)");
  else P("Can't write to THIS folder (often OneDrive-redirected Downloads on work PCs). Move the PDF to a plain folder like  C:\\1042s\\  and run  probe()  again.");
  P("(Delete the _probe*.pdf test files afterward.)");
  P("==================================================");
}

P("1042-S Organizer (v3) loaded.");
P("TROUBLE SAVING?  run:  probe()   <- tells you exactly why in 2 seconds");
P("Calibrate:  testName(1)   scan(1,20)   dumpWords(1)");
P("Run:        organize()      (preview first; then set CONFIG.dryRun=false)");
P("Retrieve:   find(\"name\")   openForm(\"Exact Name\")   Manifest: exportIndexCSV()");

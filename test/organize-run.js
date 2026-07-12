/* Drives the whole chunked organize() end-to-end against a mocked Acrobat:
   fake app.setTimeOut (so the async batching actually runs) + a tiny virtual
   filesystem for extractPages/openDoc/insertPages/saveAs. Proves the chunked
   state machine produces the right per-recipient files, combined file, and
   index — in BOTH async mode and the synchronous fallback.  node test/organize-run.js */

var fs = require("fs");
var path = require("path");
if (!console.println) console.println = function () {};

/* ---- shared globals the organizer expects ---- */
var FS, WLOG, Q;                                  // virtual file system, write log, setTimeout queue
global.app = null;                                // set per-mode below
eval(fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8"));
var FNS = { "_scanTick()": _scanTick, "_writeTick()": _writeTick, "_combineTick()": _combineTick, "_dupeTick()": _dupeTick, "_moveTick()": _moveTick };

/* ---- synthetic 1042-S pages ---- */
function quad(w) { return [[w.x0, w.y0, w.x1, w.y0, w.x1, w.y1, w.x0, w.y1]]; }
function boundary() {
  return [
    { t: "13a", x0: 48, y0: 96, x1: 62, y1: 104 }, { t: "Recipient's", x0: 68, y0: 96, x1: 118, y1: 104 },
    { t: "name", x0: 122, y0: 96, x1: 150, y1: 104 }, { t: "13b", x0: 398, y0: 96, x1: 412, y1: 104 },
    { t: "country", x0: 418, y0: 96, x1: 470, y1: 104 }, { t: "code", x0: 474, y0: 96, x1: 500, y1: 104 },
    { t: "13c", x0: 48, y0: 140, x1: 62, y1: 148 }, { t: "Address", x0: 68, y0: 140, x1: 120, y1: 148 }
  ];
}
function formPage(name) {
  var b = boundary(), parts = String(name).split(" "), val = [], x = 58, i;
  for (i = 0; i < parts.length; i++) { val.push({ t: parts[i], x0: x, y0: 112, x1: x + 46, y1: 122 }); x += 54; }
  return b.slice(0, 3).concat(val).concat(b.slice(3));
}
function instructionPage() {
  var toks = "Instructions for Recipient Box income code amounts subject to reporting see back".split(" ");
  var w = [], x = 60, i; for (i = 0; i < toks.length; i++) { w.push({ t: toks[i], x0: x, y0: 220, x1: x + 40, y1: 228 }); x += 46; if (x > 520) x = 60; } return w;
}

var SEQ = ["apple", "banana", "apple", "chain", "delta", "banana", "echo", "apple",
  "foxtrot", "chain", "golf", "hotel", "echo", "india", "juliet"];   // 15 forms, 10 unique, shuffled
var PAGES = [], NAMEOF = [];
for (var s = 0; s < SEQ.length; s++) { PAGES.push(formPage(SEQ[s])); NAMEOF.push(SEQ[s]); PAGES.push(instructionPage()); NAMEOF.push("(i)"); }
var TOTAL = PAGES.length;   // 30

var READS = 0;
function makeDoc() {
  return {
    numPages: PAGES.length, path: "/T/source.pdf",
    getPageNumWords: function (p) { return PAGES[p].length; },
    getPageNthWord: function (p, i) { READS++; return PAGES[p][i].t; },
    getPageNthWordQuads: function (p, i) { return quad(PAGES[p][i]); },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; },
    extractPages: function (o) { if (o.cPath === this.path) throw new Error("refuse overwrite source"); FS[o.cPath] = (o.nEnd - o.nStart + 1); WLOG.push(o.cPath); }
  };
}
function makeApp(withTimeout) {
  var a = {
    openDoc: function (o) {
      var p = o.cPath, cnt = FS[p] || 0;
      return { numPages: cnt,
        insertPages: function (io) { cnt += (io.nEnd - io.nStart + 1); this.numPages = cnt; FS[p] = cnt; },
        saveAs: function (so) { FS[so.cPath] = cnt; },
        closeDoc: function () {} };
    }
  };
  if (withTimeout) a.setTimeOut = function (expr) { Q.push(expr); return {}; };
  return a;
}

var fails = 0, passes = 0;
function check(label, cond) { if (cond) passes++; else { fails++; console.log("FAIL  " + label); } }

function run(mode) {
  FS = {}; WLOG = []; Q = []; _SCAN_CACHE = null;
  global.app = makeApp(mode === "async");
  G_DOC = makeDoc();
  CONFIG.dryRun = false; CONFIG.mode = "both"; CONFIG.filePrefix = "1042S_";
  organize();
  var guard = 0;
  while (Q.length) { var e = Q.shift(); FNS[e](); if (++guard > 100000) throw new Error("runaway"); }  // drain scheduled batches

  var uniq = {}; for (var i = 0; i < SEQ.length; i++) uniq[SEQ[i]] = 1;
  var uniqNames = Object.keys(uniq);
  var perFiles = 0, perPages = 0, k;
  for (k in FS) { var base = k.replace(/^.*\//, ""); if (base.indexOf("1042S_") === 0) { perFiles++; perPages += FS[k]; } }

  console.log("[" + mode + "] files:", Object.keys(FS).length, " per-recipient:", perFiles, " combined pages:", FS["/T/_ORGANIZED_1042S_sorted.pdf"]);
  check("[" + mode + "] one file per unique recipient (10)", perFiles === uniqNames.length);
  check("[" + mode + "] per-recipient pages sum to all pages (no loss)", perPages === TOTAL);
  check("[" + mode + "] combined file has every page", FS["/T/_ORGANIZED_1042S_sorted.pdf"] === TOTAL);
  check("[" + mode + "] source PDF never written", !FS.hasOwnProperty("/T/source.pdf"));
  check("[" + mode + "] index built for all recipients", RECIPIENT_INDEX && RECIPIENT_INDEX.length === uniqNames.length);
  check("[" + mode + "] every index entry marked existing", RECIPIENT_INDEX.every ? RECIPIENT_INDEX.every(function (r) { return r.exists; }) : true);
  var apple = null, ai; for (ai = 0; ai < RECIPIENT_INDEX.length; ai++) if (RECIPIENT_INDEX[ai].name === "apple") apple = RECIPIENT_INDEX[ai];
  check("[" + mode + "] apple grouped (3 forms + 3 instr = 6 pages)", apple && apple.pageCount === 6);
  check("[" + mode + "] _RUN cleared at end", _RUN === null);
}

console.log("=== ASYNC mode (chunked via app.setTimeOut) ===");
run("async");
console.log("\n=== SYNC fallback (no app.setTimeOut) ===");
run("sync");

console.log("\n=== REORDER PLAN (movePage sequence) fuzz ===");
(function () {
  function applyMoves(n, ops) {                 // simulate Acrobat movePage(from, after)
    var a = []; for (var i = 0; i < n; i++) a.push(i);
    for (var k = 0; k < ops.length; k++) { var v = a.splice(ops[k].from, 1)[0]; a.splice(ops[k].after + 1, 0, v); }
    return a;
  }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var ok = true, worst = null;
  for (var t = 1; t <= 300; t++) {
    var r = rng(t), n = 2 + Math.floor(r() * 60), target = [];
    for (var i = 0; i < n; i++) target.push(i);
    for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = target[i]; target[i] = target[j]; target[j] = tmp; }  // shuffle
    var result = applyMoves(n, reorderPlan(target));
    if (result.join(",") !== target.join(",")) { ok = false; if (!worst) worst = { t: t, target: target, result: result }; }
  }
  if (worst) console.log("  FAILED seed " + worst.t + " target=" + worst.target + " got=" + worst.result);
  check("reorderPlan reproduces every one of 300 random target orders", ok);
})();

console.log("\n=== IN-PLACE MODE (reorder the open PDF itself, write no files) ===");
(function () {
  _SCAN_CACHE = null; FS = {}; Q = [];
  var pageOrder = []; for (var i = 0; i < PAGES.length; i++) pageOrder.push(i);   // doc's live page sequence (original ids)
  global.app = { openDoc: function () { throw new Error("should not open/write in inplace mode"); } };
  G_DOC = makeDoc();
  G_DOC.extractPages = function () { throw new Error("should not write files in inplace mode"); };
  G_DOC.movePage = function (from, after) { var v = pageOrder.splice(from, 1)[0]; pageOrder.splice(after + 1, 0, v); };
  CONFIG.mode = "inplace"; CONFIG.dryRun = false;
  organize(); while (Q.length) FNS[Q.shift()]();

  var uniq = {}; for (i = 0; i < SEQ.length; i++) uniq[SEQ[i]] = 1;
  var sortedNames = Object.keys(uniq).sort(), expected = [];
  for (i = 0; i < sortedNames.length; i++) for (var s2 = 0; s2 < SEQ.length; s2++) if (SEQ[s2] === sortedNames[i]) { expected.push(2 * s2); expected.push(2 * s2 + 1); }
  check("in-place: open PDF's physical page order becomes alphabetical", pageOrder.join(",") === expected.join(","));
  check("in-place: no page lost (still all pages)", pageOrder.length === PAGES.length);
  check("in-place: wrote NO output files", Object.keys(FS).length === 0);
  check("in-place: scan cache cleared after moving pages", _SCAN_CACHE === null);
  var pairedOk = true; for (i = 0; i < pageOrder.length; i += 2) if (pageOrder[i + 1] !== pageOrder[i] + 1 || pageOrder[i] % 2 !== 0) pairedOk = false;
  check("in-place: every form page still followed by its instruction", pairedOk);
  CONFIG.mode = "both";
})();

console.log("\n=== PHYSICAL PAGE ORDER (combined file must be truly re-sorted) ===");
(function () {
  /* mock that records the exact SEQUENCE of source pages placed in each output */
  var ORD = {};
  _SCAN_CACHE = null; FS = {}; Q = [];
  function put(path, s, e) { if (!ORD[path]) ORD[path] = []; for (var x = s; x <= e; x++) ORD[path].push(x); }
  global.app = {
    openDoc: function (o) {
      var p = (typeof o === "object") ? o.cPath : o;
      return { numPages: (ORD[p] || []).length,
        insertPages: function (io) { put(p, io.nStart, io.nEnd); this.numPages = ORD[p].length; FS[p] = ORD[p].length; },
        saveAs: function (so) { var d = (typeof so === "object") ? so.cPath : so; ORD[d] = (ORD[p] || []).slice(); FS[d] = ORD[d].length; },
        closeDoc: function () {} };
    }
  };
  G_DOC = makeDoc();
  G_DOC.extractPages = function (o) { ORD[o.cPath] = []; put(o.cPath, o.nStart, o.nEnd); FS[o.cPath] = ORD[o.cPath].length; };
  CONFIG.dryRun = false; CONFIG.mode = "both";
  organize(); while (Q.length) FNS[Q.shift()]();

  /* expected physical order: recipients A->Z, each one's form+instruction pages in original order */
  var uniq = {}, i; for (i = 0; i < SEQ.length; i++) uniq[SEQ[i]] = 1;
  var sortedNames = Object.keys(uniq).sort();
  var expected = [];
  for (i = 0; i < sortedNames.length; i++) for (var s2 = 0; s2 < SEQ.length; s2++) if (SEQ[s2] === sortedNames[i]) { expected.push(2 * s2); expected.push(2 * s2 + 1); }
  var got = ORD["/T/_ORGANIZED_1042S_sorted.pdf"] || [];
  check("combined file page SEQUENCE = alphabetical recipient order", got.join(",") === expected.join(","));
  check("combined file physically reordered (not original order)", got.join(",") !== Object.keys(PAGES).map(Number).join(","));
  /* every form page is physically followed by its instruction page */
  var paired = true;
  for (i = 0; i < got.length; i += 2) if (got[i + 1] !== got[i] + 1 || got[i] % 2 !== 0) paired = false;
  check("in the sorted file every form page is physically followed by its instruction", paired);
  /* per-recipient file for 'apple' contains exactly apple's pages in ascending order */
  var appleExpected = [];
  for (i = 0; i < SEQ.length; i++) if (SEQ[i] === "apple") { appleExpected.push(2 * i); appleExpected.push(2 * i + 1); }
  check("apple's own file = apple's pages in order", (ORD["/T/1042S_apple.pdf"] || []).join(",") === appleExpected.join(","));
})();

console.log("\n=== POSITIONAL-ONLY ACROBAT (client build rejecting object-form args) ===");
(function () {
  /* simulates the Windows build that throws RangeError: Invalid argument value
     for extractPages({...}) etc. — only classic positional signatures work */
  function rej() { throw new Error("RangeError: Invalid argument value"); }
  _SCAN_CACHE = null; FS = {}; Q = [];
  global.app = {
    openDoc: function (a) {
      if (typeof a === "object") rej();
      var p = a, cnt = FS[p] || 0;
      return { numPages: cnt,
        insertPages: function (n, sp, s, e) { if (typeof n === "object") rej(); cnt += (e - s + 1); this.numPages = cnt; FS[p] = cnt; },
        saveAs: function (sp) { if (typeof sp === "object") rej(); FS[sp] = cnt; },
        closeDoc: function () {} };
    }
  };
  G_DOC = makeDoc();
  G_DOC.extractPages = function (s, e, p) { if (typeof s === "object") rej(); if (p === this.path) throw new Error("overwrite!"); FS[p] = (e - s + 1); };
  CONFIG.dryRun = false; CONFIG.mode = "both";
  organize(); while (Q.length) FNS[Q.shift()]();
  var per = 0, pp = 0, k;
  for (k in FS) { var b = k.replace(/^.*\//, ""); if (b.indexOf("1042S_") === 0) { per++; pp += FS[k]; } }
  check("[positional] all 10 recipient files written via fallback", per === 10);
  check("[positional] no page lost", pp === TOTAL);
  check("[positional] combined file complete", FS["/T/_ORGANIZED_1042S_sorted.pdf"] === TOTAL);
})();

console.log("\n=== SECURITY-LOCKED PDF (extraction forbidden) fails fast, before the scan ===");
(function () {
  _SCAN_CACHE = null; FS = {}; Q = [];
  var reads = 0, threw = false;
  global.app = { openDoc: function () { throw new Error("no"); } };
  G_DOC = makeDoc();
  G_DOC.securityHandler = "Standard";
  G_DOC.getPageNthWord = function (p, i) { reads++; return PAGES[p][i].t; };
  G_DOC.extractPages = function () { throw new Error("RangeError: Invalid argument value"); };  // locked: every form refused
  CONFIG.dryRun = false; CONFIG.mode = "both";
  try { organize(); while (Q.length) FNS[Q.shift()](); } catch (e) { threw = true; }
  check("locked: no exception escapes", !threw);
  check("locked: aborted BEFORE scanning any pages", reads === 0);
  check("locked: no output files", Object.keys(FS).length === 0);
  check("locked: no run left dangling", _RUN === null);
})();

console.log("\n=== IN-PLACE with movePage refused (Document Assembly locked) ===");
(function () {
  _SCAN_CACHE = null; FS = {}; Q = [];
  global.app = { openDoc: function () { throw new Error("no"); } };
  G_DOC = makeDoc();
  var before = []; for (var i = 0; i < PAGES.length; i++) before.push(i);
  G_DOC.movePage = function () { throw new Error("NotAllowedError: Security settings prevent this"); };
  CONFIG.mode = "inplace"; CONFIG.dryRun = false;
  var threw = false;
  try { organize(); while (Q.length) FNS[Q.shift()](); } catch (e) { threw = true; }
  check("inplace-locked: no exception escapes", !threw);
  check("inplace-locked: run finished (reported refusals) and cleared", _RUN === null);
  CONFIG.mode = "both";
})();

console.log("\n=== SCAN CACHE (preview then real run must not re-read) ===");
(function () {
  _SCAN_CACHE = null; FS = {}; Q = []; global.app = makeApp(false); G_DOC = makeDoc(); CONFIG.mode = "both";
  READS = 0; CONFIG.dryRun = true; organize(); while (Q.length) FNS[Q.shift()]();
  var previewReads = READS;
  READS = 0; CONFIG.dryRun = false; organize(); while (Q.length) FNS[Q.shift()]();
  var realReads = READS;
  check("preview actually read the pages", previewReads > 0);
  check("real run reused the scan (0 new page reads)", realReads === 0);
  check("real run still wrote all recipient files", (function () { var n = 0, k; for (k in FS) { var b = k.replace(/^.*\//, ""); if (b.indexOf("1042S_") === 0) n++; } return n === 10; })());
})();

console.log("\n==================================================");
console.log(fails === 0 ? ("ALL " + passes + " CHECKS PASSED") : (fails + " FAILED, " + passes + " passed"));
console.log("==================================================");
process.exit(fails === 0 ? 0 : 1);

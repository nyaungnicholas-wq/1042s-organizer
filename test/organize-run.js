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
var FNS = { "_scanTick()": _scanTick, "_writeTick()": _writeTick, "_combineTick()": _combineTick, "_dupeTick()": _dupeTick };

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

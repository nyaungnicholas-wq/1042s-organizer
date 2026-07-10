/* Heavy developer test (Node, not Acrobat):  node test/stress-run.js
   Covers the v2 hardening: variable-length interleaved packets, scale, foreign
   (non-Latin) names staying distinct, placeholder values kept separate,
   unreadable-page quarantine, prose-page rejection, source-overwrite guard,
   and adversarial filename security. */

var fs = require("fs");
var path = require("path");
if (!console.println) console.println = function () {};
global.app = { openDoc: function () { throw new Error("no openDoc in Node"); } };
var src = fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8");
eval(src);

var fails = 0, passes = 0;
function check(label, cond) { if (cond) passes++; else { fails++; console.log("FAIL  " + label); } }

function quad(w) { return [[w.x0, w.y0, w.x1, w.y0, w.x1, w.y1, w.x0, w.y1]]; }
function boundary() {
  return [
    { t: "13a", x0: 48, y0: 96, x1: 62, y1: 104 },
    { t: "13b", x0: 398, y0: 96, x1: 412, y1: 104 },
    { t: "country", x0: 418, y0: 96, x1: 470, y1: 104 },
    { t: "code", x0: 474, y0: 96, x1: 500, y1: 104 },
    { t: "13c", x0: 48, y0: 140, x1: 62, y1: 148 },
    { t: "Address", x0: 68, y0: 140, x1: 120, y1: 148 }
  ];
}
function formPage(name) {
  var parts = String(name).split(" "), words = [], x = 58, i;
  for (i = 0; i < parts.length; i++) { words.push({ t: parts[i], x0: x, y0: 112, x1: x + 46, y1: 122 }); x += 54; }
  return words.concat(boundary());
}
function formNoName() { return boundary(); }
function instructionPage() {
  var toks = "Instructions for Recipient Box 1 income code amounts subject to reporting".split(" ");
  var words = [], x = 60, i;
  for (i = 0; i < toks.length; i++) { words.push({ t: toks[i], x0: x, y0: 220, x1: x + 40, y1: 228 }); x += 46; if (x > 520) x = 60; }
  return words;
}
/* a prose page that merely CITES box numbers inline (should NOT be seen as a form) */
function prosePage() {
  return [
    { t: "See", x0: 60, y0: 300, x1: 80, y1: 308 },
    { t: "13a", x0: 84, y0: 300, x1: 100, y1: 308 },   // all on the same row, scattered
    { t: "and", x0: 104, y0: 300, x1: 124, y1: 308 },
    { t: "13b", x0: 128, y0: 300, x1: 148, y1: 308 },
    { t: "13c", x0: 152, y0: 300, x1: 172, y1: 308 },
    { t: "for", x0: 176, y0: 300, x1: 196, y1: 308 }
  ];
}
function makeDoc(pages) {
  return {
    numPages: pages.length, path: "/T/data.pdf",
    getPageNumWords: function (p) { return pages[p].length; },
    getPageNthWord: function (p, i) { return pages[p][i].t; },
    getPageNthWordQuads: function (p, i) { return quad(pages[p][i]); },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; }
  };
}
function cover(det) { var c = det.headerPages.length + det.reviewPages.length; for (var i = 0; i < det.segments.length; i++) c += det.segments[i].pages.length; return c; }

/* ===== A: variable-length interleaved multi-copy packet stays ONE ===== */
console.log("A: packet shapes");
(function () {
  var p = [];
  p.push(formPage("ACME CORP")); p.push(instructionPage());
  p.push(formPage("ACME CORP")); p.push(instructionPage());
  p.push(formPage("ACME CORP")); p.push(instructionPage());
  p.push(formPage("BETA LLC"));  p.push(instructionPage());
  var det = detectSegments(makeDoc(p));
  check("A 3-copy interleaved packet = ONE segment of 6 pages", det.segments.length === 2 && det.segments[0].pages.length === 6);
  check("A no page lost", cover(det) === 8);
})();

/* ===== B: foreign (non-Latin) names stay DISTINCT (the HIGH bug) ===== */
console.log("B: i18n");
(function () {
  var p = [];
  p.push(formPage("株式会社トヨタ")); p.push(instructionPage());
  p.push(formPage("本田技研"));       p.push(instructionPage());
  p.push(formPage("ACME INC"));       p.push(instructionPage());
  p.push(formPage("株式会社トヨタ")); p.push(instructionPage());
  var det = detectSegments(makeDoc(p));
  var g = groupByRecipient(det.segments);
  check("B four packets (foreign names not welded)", det.segments.length === 4);
  check("B three distinct recipients (Toyota appears twice)", g.length === 3);
  var toyotaRuns = 0, i;
  for (i = 0; i < g.length; i++) if (g[i].displayName === "株式会社トヨタ") toyotaRuns = g[i].segCount;
  check("B Toyota grouped into 2 runs", toyotaRuns === 2);
  check("B foreign filename safe + non-empty", safeFilename("株式会社トヨタ") === "株式会社トヨタ");
})();

/* ===== C: placeholder values kept SEPARATE, not merged ===== */
console.log("C: placeholders");
(function () {
  var p = [];
  p.push(formPage("Unknown Recipient")); p.push(instructionPage());
  p.push(formPage("REAL COMPANY"));      p.push(instructionPage());
  p.push(formPage("Unknown Recipient")); p.push(instructionPage());
  var det = detectSegments(makeDoc(p));
  var g = groupByRecipient(det.segments);
  check("C two Unknown packets stay separate (3 groups total)", g.length === 3);
  var ph = 0, i; for (i = 0; i < g.length; i++) if (g[i].placeholder) ph++;
  check("C both Unknown groups flagged placeholder", ph === 2);
  var folder = "/T/"; assignFilenames(g, folder);
  var files = {}; for (i = 0; i < g.length; i++) files[g[i].file] = 1;
  check("C placeholder files are distinct (dedup suffix)", Object.keys(files).length === 3);
  // adjacent identical placeholders must not weld either
  var det2 = detectSegments(makeDoc([formPage("Unknown Recipient"), formPage("Unknown Recipient")]));
  check("C adjacent Unknown forms do NOT weld", det2.segments.length === 2);
})();

/* ===== D: unreadable form page quarantined mid-run (no misattribution) ===== */
console.log("D: quarantine");
(function () {
  var p = [];
  p.push(formPage("ALPHA")); p.push(instructionPage());
  p.push(formNoName());      p.push(instructionPage());   // unreadable form + its instruction
  p.push(formPage("ALPHA")); p.push(instructionPage());
  var det = detectSegments(makeDoc(p));
  var g = groupByRecipient(det.segments);
  check("D unreadable form + trailing instr quarantined (2 pages)", det.reviewPages.length === 2);
  check("D ALPHA keeps only its own pages 0,1,4,5", g.length === 1 && g[0].pages.join(",") === "0,1,4,5");
  check("D coverage complete (quarantine counted)", cover(det) === 6);
})();

/* ===== E: prose page citing box numbers is NOT treated as a form ===== */
console.log("E: prose rejection");
(function () {
  var det = detectSegments(makeDoc([formPage("ACME"), prosePage(), formPage("BETA")]));
  check("E prose page is not a form", det.perPage[1].form === false);
  check("E prose attaches to ACME as instruction", det.segments[0].pages.join(",") === "0,1");
})();

/* ===== F: scale — ~1,200 pages, hundreds of companies ===== */
console.log("F: scale");
(function () {
  var pages = [], N = 300, reappear = [], i, c, copies, name;
  function pad4(n) { var s = "" + n; while (s.length < 4) s = "0" + s; return s; }
  for (i = 0; i < N; i++) {
    name = "COMPANY " + pad4(i) + " LLC";
    copies = 1 + (i % 4);
    for (c = 0; c < copies; c++) { pages.push(formPage(name)); if ((i + c) % 2 === 0) pages.push(instructionPage()); }
    if (i % 25 === 0) reappear.push(name);
  }
  for (i = 0; i < reappear.length; i++) { pages.push(formPage(reappear[i])); pages.push(instructionPage()); }
  var doc = makeDoc(pages);
  var t0 = Date.now();
  var det = detectSegments(doc);
  var g = groupByRecipient(det.segments);
  var ms = Date.now() - t0;
  console.log("  pages=" + doc.numPages + "  packets=" + det.segments.length + "  companies=" + g.length + "  detect=" + ms + "ms");
  check("F > 1000 pages", doc.numPages > 1000);
  check("F unique companies == 300", g.length === 300);
  check("F no page lost", cover(det) === doc.numPages);
  check("F sorted alphabetically", (function () { for (var k = 1; k < g.length; k++) if (g[k - 1].displayName.toLowerCase() > g[k].displayName.toLowerCase()) return false; return true; })());
  check("F reappearing company has 2 runs", (function () { for (var k = 0; k < g.length; k++) if (g[k].displayName === "COMPANY 0000 LLC") return g[k].segCount === 2; return false; })());
  check("F detection fast (< 4000ms)", ms < 4000);
})();

/* ===== G: filename security ===== */
console.log("G: filename security");
(function () {
  var reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  var badChars = /[\x00-\x1f\x7f\\\/:\*\?"<>\|]/;
  var cases = ["../../etc/passwd", "..\\..\\Windows\\evil", "/etc/shadow", "C:\\Windows\\x", "\\\\server\\share",
    "CON", "con", "NUL.pdf", "COM1", "LPT9", "a b", "l\r\nx\ty", ".....", "   ", "", "....hidden",
    "Smith & Jones, LLC", "O'Brien Trust", "日本株式会社", new Array(300).join("X")];
  var allSafe = true, i;
  for (i = 0; i < cases.length; i++) {
    var o = safeFilename(cases[i]);
    if (badChars.test(o) || o.charAt(0) === "." || reserved.test(o.split(".")[0]) || o.length > 120 || o.indexOf("..") >= 0) {
      allSafe = false; console.log("  UNSAFE in=" + JSON.stringify(cases[i]).slice(0, 40) + " out=" + JSON.stringify(o));
    }
  }
  check("G every adversarial name -> safe filename", allSafe);
  check("G legit punctuation preserved", safeFilename("Smith & Jones, LLC") === "Smith & Jones, LLC");
  check("G reserved CON neutralized", !reserved.test(safeFilename("CON")));
})();

/* ===== H: source-overwrite guard ===== */
console.log("H: source-overwrite guard");
(function () {
  check("H samePath detects identical paths", samePath("/T/1042S_Acme.pdf", "/T/1042S_Acme.pdf") === true);
  check("H samePath case-insensitive + trailing slash", samePath("/T/A/", "/t/a") === true);
  // build a doc whose extractPages records cPath; one recipient collides with the source name
  var calls = [];
  var doc = {
    path: "/T/1042S_Acme.pdf",
    extractPages: function (o) { calls.push(o.cPath); },
    numPages: 1
  };
  var groups = [{ key: "acme", displayName: "Acme", placeholder: false, pages: [0], segCount: 1, file: "/T/1042S_Acme.pdf" }];
  var failed = writeSplit(doc, groups, doc.path);
  check("H colliding recipient marked failed", failed["acme"] === 1);
  check("H extractPages NEVER called with the source path", calls.indexOf(doc.path) < 0);
})();

/* ===== I: index exists-flag by mode + samePath canonicalization ===== */
console.log("I: index/exists + samePath");
(function () {
  var groups = [{ key: "a", displayName: "Acme", placeholder: false, pages: [0, 1], segCount: 1 },
    { key: "b", displayName: "Beta", placeholder: false, pages: [2], segCount: 1 }];
  assignFilenames(groups, "/T/out/");
  buildIndex(groups, false, {});    // not written (dry run / combine-only)
  var allFalse = true, i; for (i = 0; i < RECIPIENT_INDEX.length; i++) if (RECIPIENT_INDEX[i].exists) allFalse = false;
  check("I exists=false when files not written", allFalse);
  buildIndex(groups, true, { b: 1 });   // written, but Beta failed
  check("I Acme exists=true after write", RECIPIENT_INDEX[0].exists === true);
  check("I Beta exists=false (failed write)", RECIPIENT_INDEX[1].exists === false);

  // samePath: NFC vs NFD of the same accented name must be treated as equal
  var nfd = "/T/Cafe" + String.fromCharCode(0x301) + ".pdf";   // e + combining acute
  var nfc = "/T/Caf" + String.fromCharCode(0xe9) + ".pdf";     // precomposed é
  check("I samePath folds NFC/NFD", samePath(nfd, nfc) === true);
  check("I samePath resolves ..", samePath("/T/a/../data.pdf", "/T/data.pdf") === true);
  check("I samePath still distinguishes different files", samePath("/T/a.pdf", "/T/b.pdf") === false);
})();

console.log("\n==================================================");
console.log(fails === 0 ? ("ALL " + passes + " CHECKS PASSED") : (fails + " FAILED, " + passes + " passed"));
console.log("==================================================");
process.exit(fails === 0 ? 0 : 1);

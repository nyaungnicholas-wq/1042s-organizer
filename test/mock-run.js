/* Basic developer test (Node, not Acrobat):  node test/mock-run.js
   Exercises the real detection/grouping/verification logic (v2) from
   ../1042s-organizer.js against a synthetic 1042-S. */

var fs = require("fs");
var path = require("path");
if (!console.println) console.println = function () {};
global.app = { openDoc: function () { throw new Error("no openDoc in Node"); } };
var src = fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8");
eval(src);

function quad(w) { return [[w.x0, w.y0, w.x1, w.y0, w.x1, w.y1, w.x0, w.y1]]; }
function boundary() {
  return [
    { t: "13a", x0: 48, y0: 96, x1: 62, y1: 104 },
    { t: "Recipient's", x0: 68, y0: 96, x1: 118, y1: 104 },
    { t: "name", x0: 122, y0: 96, x1: 150, y1: 104 },
    { t: "13b", x0: 398, y0: 96, x1: 412, y1: 104 },
    { t: "country", x0: 418, y0: 96, x1: 470, y1: 104 },
    { t: "code", x0: 474, y0: 96, x1: 500, y1: 104 },
    { t: "13c", x0: 48, y0: 140, x1: 62, y1: 148 },
    { t: "Address", x0: 68, y0: 140, x1: 120, y1: 148 }
  ];
}
function formPage(name) {
  var b = boundary(), parts = String(name).split(" "), val = [], x = 58, i;
  for (i = 0; i < parts.length; i++) { val.push({ t: parts[i], x0: x, y0: 112, x1: x + 46, y1: 122 }); x += 54; }
  /* realistic reading order: 13a, Recipient's, name, <VALUE>, 13b, ... , 13c, Address */
  return b.slice(0, 3).concat(val).concat(b.slice(3));
}
function formNoName() { return boundary(); }   // has 13a/13b/13c but no name in the box
function instructionPage() {
  var toks = "Instructions for Recipient Box 1 income code amounts subject to reporting".split(" ");
  var words = [], x = 60, i;
  for (i = 0; i < toks.length; i++) { words.push({ t: toks[i], x0: x, y0: 220, x1: x + 40, y1: 228 }); x += 46; if (x > 520) x = 60; }
  return words;
}
function makeDoc(pages) {
  return {
    numPages: pages.length, path: "/tmp/forms.pdf",
    getPageNumWords: function (p) { return pages[p].length; },
    getPageNthWord: function (p, i) { return pages[p][i].t; },
    getPageNthWordQuads: function (p, i) { return quad(pages[p][i]); },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; }
  };
}
function cover(det) { var c = det.headerPages.length + det.reviewPages.length; for (var i = 0; i < det.segments.length; i++) c += det.segments[i].pages.length; return c; }

var fails = 0, passes = 0;
function check(label, cond) { if (cond) passes++; else { fails++; console.log("FAIL  " + label); } }

/* clean A,B,A with instruction pages */
var PAGES = [];
PAGES.push(formPage("ACME CORPORATION")); PAGES.push(instructionPage());
PAGES.push(formPage("BETA LLC"));          PAGES.push(instructionPage());
PAGES.push(formPage("ACME CORPORATION")); PAGES.push(instructionPage());
var doc = makeDoc(PAGES);
console.log("MOCK RUN: clean A,B,A");
var det = detectSegments(doc);
var groups = groupByRecipient(det.segments);
verify(det, groups);

console.log("\n---- ASSERTIONS ----");
check("3 packets detected", det.segments.length === 3);
check("2 unique recipients", groups.length === 2);
check("sorted A,A,B (ACME before BETA)", groups[0].displayName === "ACME CORPORATION" && groups[1].displayName === "BETA LLC");
check("ACME grouped into 2 runs", groups[0].segCount === 2 && groups[0].pages.length === 4);
check("ACME pages are 0,1,4,5", groups[0].pages.join(",") === "0,1,4,5");
check("BETA name read correctly", groups[1].displayName === "BETA LLC");
check("instruction page attached to ACME", det.segments[0].pages.join(",") === "0,1");
check("cross-check readers agree on page 1", det.perPage[0].agree === true);
check("instruction pages are non-form", det.perPage[1].form === false && det.perPage[3].form === false);
check("coverage: every page assigned once", cover(det) === doc.numPages);

/* flag cases: unreadable form page must NOT join a recipient; near-dupe flagged */
console.log("\nMOCK RUN: flag cases");
var P2 = [formPage("ACME CORPORATION"), formNoName(), formPage("ACME CORPORATON")];
var det2 = detectSegments(makeDoc(P2));
var groups2 = groupByRecipient(det2.segments);
var v2 = verify(det2, groups2);
check("unreadable form page quarantined (not in a recipient)", det2.reviewPages.length === 1 && det2.reviewPages[0] === 1);
check("ACME CORPORATION packet does NOT include page 2", det2.segments[0].pages.join(",") === "0");
check("coverage still complete with quarantine", cover(det2) === 3);
check("run2 raised review flags", v2.issues > 0);

console.log("\n==================================================");
console.log(fails === 0 ? ("ALL " + passes + " CHECKS PASSED") : (fails + " FAILED, " + passes + " passed"));
console.log("==================================================");
process.exit(fails === 0 ? 0 : 1);

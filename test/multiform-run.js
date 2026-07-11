/* Multi-form test (Node):  node test/multiform-run.js
   Proves the organizer detects 1042-S / 1099 / W-2 / 1042 and groups each
   recipient's DIFFERENT forms together into one file (sorted A->Z), keeping
   instruction pages paired. */

var fs = require("fs");
var path = require("path");
if (!console.println) console.println = function () {};
global.app = { openDoc: function () { throw new Error("no openDoc"); } };
eval(fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8"));

var fails = 0, passes = 0;
function check(label, cond) { if (cond) passes++; else { fails++; console.log("FAIL  " + label); } }
function quad(w) { return [[w.x0, w.y0, w.x1, w.y0, w.x1, w.y1, w.x0, w.y1]]; }
function W(t, x, y) { return { t: t, x0: x, y0: y, x1: x + t.length * 5 + 4, y1: y + 8 }; }
function words(list) { return list; }

/* ---- mock pages for each form type (PDF y-up: name sits BELOW its label) ---- */
function form1042S(name) {
  var e = [W("Form", 120, 755), W("1042-S", 150, 755),
    W("13a", 48, 700), W("Recipient's", 66, 700), W("name", 118, 700),
    W("13b", 398, 700), W("country", 418, 700), W("code", 462, 700),
    W("13c", 48, 655), W("Address", 70, 655)];
  var parts = name.split(" "), x = 58, i; for (i = 0; i < parts.length; i++) { e.push(W(parts[i], x, 680)); x += 60; }
  return e;
}
function form1099(name) {
  var e = [W("1099-NEC", 400, 730),
    W("PAYER'S", 60, 660), W("name", 100, 660), W("PayerCo", 62, 644),
    W("RECIPIENT'S", 60, 500), W("name", 130, 500),
    W("Street", 60, 464), W("address", 92, 464)];
  var parts = name.split(" "), x = 62, i; for (i = 0; i < parts.length; i++) { e.push(W(parts[i], x, 484)); x += 60; }
  return e;
}
function formW2(name) {
  var e = [W("W-2", 58, 433), W("Wage", 107, 437), W("and", 140, 437), W("Tax", 162, 437), W("Statement", 185, 437),
    W("Employee's", 60, 400), W("first", 116, 400), W("name", 145, 400), W("initial", 185, 400)];
  var parts = name.split(" "), x = 62, i; for (i = 0; i < parts.length; i++) { e.push(W(parts[i], x, 384)); x += 60; }
  return e;
}
function form1042annual(agent) {
  var e = [W("1042", 54, 738), W("Annual", 90, 738), W("Withholding", 130, 738),
    W("Name", 36, 701), W("of", 66, 701), W("withholding", 82, 701), W("agent", 150, 701),
    W("No.", 65, 309), W("of", 82, 309), W("Forms", 96, 309)];
  var parts = agent.split(" "), x = 38, i; for (i = 0; i < parts.length; i++) { e.push(W(parts[i], x, 685)); x += 60; }
  return e;
}
function instruction() { return [W("Instructions", 60, 700), W("for", 120, 700), W("Recipient", 150, 700), W("keep", 60, 680), W("for", 90, 680), W("records", 110, 680)]; }

function makeDoc(pages) {
  return {
    numPages: pages.length, path: "/T/multi.pdf",
    getPageNumWords: function (p) { return pages[p].length; },
    getPageNthWord: function (p, i) { return pages[p][i].t; },
    getPageNthWordQuads: function (p, i) { return quad(pages[p][i]); },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; }
  };
}
var DIMS = { w: 612, h: 792 };

/* convert a raw element list into the word format identifyForm expects (like pageWords) */
function toWords(list) {
  var out = [], i, e;
  for (i = 0; i < list.length; i++) { e = list[i]; out.push({ i: i, text: e.t, ntext: normTok(e.t), bb: { xmin: e.x0, xmax: e.x1, ymin: e.y0, ymax: e.y1 }, xc: (e.x0 + e.x1) / 2, yc: (e.y0 + e.y1) / 2 }); }
  return out;
}

/* ---- A: each form type is detected + name read ---- */
console.log("A: per-form detection");
check("A 1042-S detected + name", (function () { var f = identifyForm(toWords(form1042S("John Smith")), DIMS); return f.type === "1042-S" && f.name === "John Smith"; })());
check("A 1099 detected + recipient name (not payer)", (function () { var f = identifyForm(toWords(form1099("John Smith")), DIMS); return f.type === "1099" && f.name === "John Smith"; })());
check("A W-2 detected + employee name", (function () { var f = identifyForm(toWords(formW2("Jane Doe")), DIMS); return f.type === "W-2" && f.name === "Jane Doe"; })());
check("A 1042 annual detected + agent name + annual flag", (function () { var f = identifyForm(toWords(form1042annual("Big Corp")), DIMS); return f.type === "1042" && f.annual === true && f.name === "Big Corp"; })());
check("A instruction page is not a form", identifyForm(toWords(instruction()), DIMS).type === null);

/* ---- B: one file per recipient, ALL their form types together ---- */
console.log("B: cross-type grouping");
(function () {
  // shuffled: John's 3 forms and Alice's 2 forms interleaved, each with an instruction
  var pages = [], pn = [];
  function add(p, nm) { pages.push(p); pn.push(nm); }
  add(form1042S("John Smith"), "John Smith"); add(instruction(), "i");
  add(form1099("Alice Jones"), "Alice Jones"); add(instruction(), "i");
  add(formW2("John Smith"), "John Smith"); add(instruction(), "i");
  add(form1099("John Smith"), "John Smith"); add(instruction(), "i");
  add(form1042S("Alice Jones"), "Alice Jones"); add(instruction(), "i");
  var det = detectSegments(makeDoc(pages));
  var groups = groupByRecipient(det.segments);
  check("B two recipients", groups.length === 2);
  check("B sorted: Alice before John", groups[0].displayName === "Alice Jones" && groups[1].displayName === "John Smith");
  // John's file should contain his 1042-S(0), W-2(4), 1099(6) + their instructions -> 6 pages
  var john = groups[1];
  check("B John's file has all 3 forms + instructions (6 pages)", john.pages.length === 6);
  check("B John's pages are 0,1,4,5,6,7", john.pages.join(",") === "0,1,4,5,6,7");
  // coverage
  var covered = det.reviewPages.length + det.headerPages.length; for (var i = 0; i < det.segments.length; i++) covered += det.segments[i].pages.length;
  check("B no page lost", covered === pages.length);
})();

/* ---- C: 1042 annual routes to its own file, not merged with a recipient ---- */
console.log("C: 1042 annual routing");
(function () {
  var pages = [form1042S("John Smith"), instruction(), form1042annual("Big Corp Withholding"), instruction()];
  var det = detectSegments(makeDoc(pages));
  var groups = groupByRecipient(det.segments);
  check("C 1042 annual is its own group", groups.length === 2);
  var found = false; for (var i = 0; i < groups.length; i++) if (groups[i].displayName === "Big Corp Withholding") found = true;
  check("C 1042 annual grouped under withholding agent", found);
})();

console.log("\n==================================================");
console.log(fails === 0 ? ("ALL " + passes + " CHECKS PASSED") : (fails + " FAILED, " + passes + " passed"));
console.log("==================================================");
process.exit(fails === 0 ? 0 : 1);

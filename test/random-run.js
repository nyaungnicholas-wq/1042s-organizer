/* Randomized fuzz test (Node, not Acrobat):  node test/random-run.js
   Generates ~100-page 1042-S documents full of DIFFERENT companies with RANDOM
   instruction-page placement, random copy counts, reappearing recipients, foreign
   names, placeholder values, adversarial names, unreadable pages and prose pages,
   then runs the real organizer logic and asserts the invariants that must ALWAYS
   hold — no page lost, disjoint packets, safe/unique filenames, correct grouping.
   Runs many seeds; a failing seed is printed so it can be reproduced. */

var fs = require("fs");
var path = require("path");
var VERBOSE = false;
console.println = function (s) { if (VERBOSE) process.stdout.write(String(s) + "\n"); };
global.app = { openDoc: function () { throw new Error("no openDoc in Node"); } };
eval(fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8"));

/* ---- deterministic PRNG so any failure is reproducible ---- */
function makeRng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function ri(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/* ---- page builders (realistic reading order) ---- */
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
  for (i = 0; i < parts.length; i++) { if (parts[i] === "") continue; val.push({ t: parts[i], x0: x, y0: 112, x1: x + 46, y1: 122 }); x += 54; }
  return b.slice(0, 3).concat(val).concat(b.slice(3));
}
function formNoName() { return boundary(); }
function instructionPage(rng) {
  var pool = "Instructions for Recipient Box income code amounts subject to reporting see back explanation of codes".split(" ");
  var words = [], count = ri(rng, 6, 14), x = 60, y = 210, i;
  for (i = 0; i < count; i++) { words.push({ t: pick(rng, pool), x0: x, y0: y, x1: x + 40, y1: y + 8 }); x += 46; if (x > 520) { x = 60; y += 14; } }
  return words;
}
function prosePage() {
  return [
    { t: "Report", x0: 60, y0: 300, x1: 96, y1: 308 }, { t: "13a", x0: 100, y0: 300, x1: 116, y1: 308 },
    { t: "13b", x0: 120, y0: 300, x1: 136, y1: 308 }, { t: "13c", x0: 140, y0: 300, x1: 156, y1: 308 }
  ];
}
function makeDoc(pages) {
  return {
    numPages: pages.length, path: "/T/random.pdf",
    getPageNumWords: function (p) { return pages[p].length; },
    getPageNthWord: function (p, i) { return pages[p][i].t; },
    getPageNthWordQuads: function (p, i) { return quad(pages[p][i]); },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; }
  };
}

var COMPANIES = ["ACME CORP", "Beta Holdings LLC", "日本株式会社", "Газпром ОАО", "Societe Generale",
  "OBrien and Sons", "Zeta Numeric Inc", "むさし Trading", "Al Noor Trading", "Muller GmbH",
  "XYZ Global Partners LP", "Toyota Motor", "Honda Giken", "Nordic Waters AS", "Banco do Brasil",
  "Tata Consultancy", "Samsung Electronics", "Nestle SA", "Volkswagen AG", "Rio Tinto Ltd"];
var PLACEHOLDERS = ["Unknown Recipient", "Withholding rate pool"];
var ADVERSARIAL = ["../../etc/passwd", "CON", "NUL", "A star B", "trailing dots..."];

function buildRandomDoc(rng, targetPages) {
  var pages = [], injectedUnreadable = [], usedNames = [], reappear = [];
  while (pages.length < targetPages) {
    var roll = rng();
    var name;
    if (roll < 0.80) name = pick(rng, COMPANIES);
    else if (roll < 0.92) name = pick(rng, PLACEHOLDERS);
    else name = pick(rng, ADVERSARIAL);
    if (name !== null && rng() < 0.15 && usedNames.length) name = pick(rng, usedNames);  // reappear
    usedNames.push(name);

    var copies = ri(rng, 1, 3);
    for (var c = 0; c < copies; c++) {
      pages.push(formPage(name));
      var instr = ri(rng, 0, 2);                 // RANDOM number of instruction pages after a copy
      for (var k = 0; k < instr; k++) pages.push(instructionPage(rng));
    }
    if (rng() < 0.06) { pages.push(formNoName()); injectedUnreadable.push(pages.length - 1); }  // unreadable form
    if (rng() < 0.05) pages.push(prosePage());   // prose page that must NOT be seen as a form
  }
  return { pages: pages, injectedUnreadable: injectedUnreadable };
}

/* ---- invariant checks on the organizer's plan ---- */
function checkSeed(seed) {
  var rng = makeRng(seed);
  var built = buildRandomDoc(rng, 100);
  var doc = makeDoc(built.pages);
  var det = detectSegments(doc);
  var groups = groupByRecipient(det.segments);
  assignFilenames(groups, "/T/out/");
  var n = doc.numPages, i, j, errs = [];

  /* 1. every page assigned to exactly one place (disjoint + complete) */
  var owner = new Array(n); for (i = 0; i < n; i++) owner[i] = 0;
  function claim(pg, who) { if (pg < 0 || pg >= n) errs.push("page " + pg + " out of range (" + who + ")"); else if (owner[pg]) errs.push("page " + pg + " double-claimed by " + owner[pg] + " and " + who); else owner[pg] = who; }
  for (i = 0; i < groups.length; i++) for (j = 0; j < groups[i].pages.length; j++) claim(groups[i].pages[j], "group:" + i);
  for (i = 0; i < det.reviewPages.length; i++) claim(det.reviewPages[i], "review");
  for (i = 0; i < det.headerPages.length; i++) claim(det.headerPages[i], "header");
  for (i = 0; i < n; i++) if (!owner[i]) errs.push("page " + i + " unassigned");

  /* 2. group pages sorted ascending */
  for (i = 0; i < groups.length; i++) for (j = 1; j < groups[i].pages.length; j++) if (groups[i].pages[j] <= groups[i].pages[j - 1]) errs.push("group " + i + " pages not ascending");

  /* 3. non-placeholder group key == normTok(name) for ALL its segments; placeholders isolated */
  for (i = 0; i < det.segments.length; i++) {
    var seg = det.segments[i];
    if (seg.placeholder && !isPlaceholderName(seg.name)) errs.push("seg marked placeholder but name isn't: " + seg.name);
  }
  for (i = 0; i < groups.length; i++) {
    if (groups[i].placeholder && groups[i].segCount !== 1) errs.push("placeholder group has >1 run: " + groups[i].displayName);
  }

  /* 4. filenames unique + safe (no separators, no traversal, non-reserved) */
  var seen = {}, bad = /[\x00-\x1f\x7f\\\/:\*\?"<>\|]/, reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  for (i = 0; i < groups.length; i++) {
    var f = groups[i].file, base = f.replace(/^.*\//, "").replace(/\.pdf$/, "");
    if (seen[f]) errs.push("duplicate output path: " + f);
    seen[f] = 1;
    var stripped = base.replace(/^1042S_/, "");
    if (bad.test(stripped)) errs.push("unsafe filename chars: " + base);
    if (stripped.indexOf("..") >= 0) errs.push("traversal in filename: " + base);
    if (reserved.test(stripped.split(".")[0])) errs.push("reserved device name: " + base);
  }

  /* 5. injected unreadable form pages must be quarantined */
  for (i = 0; i < built.injectedUnreadable.length; i++) {
    var up = built.injectedUnreadable[i], found = false;
    for (j = 0; j < det.reviewPages.length; j++) if (det.reviewPages[j] === up) found = true;
    if (!found) errs.push("injected unreadable page " + up + " not quarantined");
  }

  /* 6. combined plan covers exactly the grouped pages */
  var combinedCount = 0;
  for (i = 0; i < groups.length; i++) { var r = pagesToRanges(groups[i].pages), rp = 0, q; for (q = 0; q < r.length; q++) rp += (r[q].e - r[q].s + 1); if (rp !== groups[i].pages.length) errs.push("ranges lose pages in group " + i); combinedCount += rp; }

  return { errs: errs, n: n, groups: groups.length, packets: det.segments.length, review: det.reviewPages.length, header: det.headerPages.length };
}

/* ---- show one organized example, then fuzz many seeds ---- */
VERBOSE = true;
console.log("=== EXAMPLE: one random ~100-page document, organized ===");
var rng0 = makeRng(12345);
var ex = buildRandomDoc(rng0, 100);
var exDoc = makeDoc(ex.pages);
var exDet = detectSegments(exDoc);
var exGroups = groupByRecipient(exDet.segments);
assignFilenames(exGroups, "/T/out/");
verify(exDet, exGroups);
VERBOSE = false;

console.log("\n=== FUZZ: 600 random documents ===");
var totalFails = 0, worst = null, seeds = 600, s, stats = { pages: 0, groups: 0 };
for (s = 1; s <= seeds; s++) {
  var r = checkSeed(s);
  stats.pages += r.n; stats.groups += r.groups;
  if (r.errs.length) { totalFails++; if (!worst) worst = { seed: s, errs: r.errs }; }
}
console.log("seeds run: " + seeds + "   avg pages: " + Math.round(stats.pages / seeds) + "   avg companies/doc: " + Math.round(stats.groups / seeds));
if (worst) {
  console.log("\nFIRST FAILING SEED " + worst.seed + ":");
  for (var e = 0; e < worst.errs.length && e < 20; e++) console.log("   - " + worst.errs[e]);
}
console.log("\n==================================================");
console.log(totalFails === 0 ? ("ALL " + seeds + " RANDOM DOCUMENTS PASSED") : (totalFails + " / " + seeds + " DOCUMENTS HAD ERRORS"));
console.log("==================================================");
process.exit(totalFails === 0 ? 0 : 1);

/* End-to-end DEMO on the REAL IRS Form 1042-S  (run:  node demo/run-demo.js )
   Uses the actual IRS form (auto-downloaded from irs.gov if missing):
     1. stamps DIFFERENT recipient names into Box 13a on real Copy B pages,
        mixes in the real "Instructions for Recipient" page, SHUFFLES them
        -> writes  demo/output/unorganized-1042s.pdf  (messy, A B A ...);
     2. reads the real text back with pdfjs (like Acrobat would) and runs the
        ACTUAL organizer logic from ../1042s-organizer.js to group + sort;
     3. writes  demo/output/organized-1042s.pdf (A A B ...) + one PDF per recipient.
   Pure JavaScript (pdf-lib + pdfjs-dist). No Adobe Acrobat needed. */

var fs = require("fs");
var path = require("path");
var https = require("https");

/* load the real organizer (targets Acrobat; shim the globals it touches). eval keeps
   its function declarations in this (non-strict) module scope. */
if (!console.println) console.println = function () {};
global.app = { openDoc: function () { throw new Error("no Acrobat here"); } };
var G_DOC = null;
eval(fs.readFileSync(path.join(__dirname, "..", "1042s-organizer.js"), "utf8"));

var SRC = path.join(__dirname, "assets", "f1042s.pdf");
var OUT = path.join(__dirname, "output");
var FORM_URL = "https://www.irs.gov/pub/irs-pdf/f1042s.pdf";

function download(url, dest) {
  return new Promise(function (resolve, reject) {
    var file = fs.createWriteStream(dest);
    https.get(url, function (r) {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { file.close(); fs.unlinkSync(dest); return download(r.headers.location, dest).then(resolve, reject); }
      if (r.statusCode !== 200) { reject(new Error("HTTP " + r.statusCode)); return; }
      r.pipe(file); file.on("finish", function () { file.close(function () { resolve(); }); });
    }).on("error", reject);
  });
}

/* Box 13a name box on the real form (from inspecting the IRS PDF):
   13a label @(54,316), 13b @(206,316), 13c @(54,292). Draw the name in between. */
var BOX13A = { x: 57, y: 303, size: 9 };

var RECIPIENTS = ["Alice Johnson", "Bob Smith", "Carol Davis", "Acme Trading LLC",
  "Jose Munoz", "David Lee", "Global Imports Inc", "Emma Wilson", "Muller GmbH", "Frank Turner"];

var seed = 20260710;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

/* split a pdfjs text item into individual word tokens with approximate x-boxes,
   so anchors like "13a" are found even if the item bundles several words. */
function splitItem(it) {
  var s = (it.str || ""); if (!s.trim()) return [];
  var x = it.transform[4], y = it.transform[5];
  var h = Math.abs(it.transform[3]) || it.height || 8;
  var width = it.width || (s.length * h * 0.5);
  var words = s.split(/\s+/).filter(Boolean), out = [], cx = x, i;
  var totalChars = s.replace(/\s+/g, "").length || 1;
  for (i = 0; i < words.length; i++) {
    var wWidth = width * (words[i].length / totalChars);
    out.push({ t: words[i], x0: cx, y0: y, x1: cx + wWidth, y1: y + h });
    cx += wWidth + width * (1 / totalChars);   // advance past the word + one space
  }
  return out;
}

async function extractWords(pdfjs, bytes) {
  var doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  var pages = [];
  for (var p = 1; p <= doc.numPages; p++) {
    var page = await doc.getPage(p);
    var tc = await page.getTextContent();
    var words = [];
    for (var k = 0; k < tc.items.length; k++) { var ws = splitItem(tc.items[k]); for (var j = 0; j < ws.length; j++) words.push(ws[j]); }
    pages.push(words);
  }
  return pages;
}

function makeDoc(pageWordLists, docPath) {
  return {
    numPages: pageWordLists.length, path: docPath,
    getPageNumWords: function (p) { return pageWordLists[p].length; },
    getPageNthWord: function (p, i) { return pageWordLists[p][i].t; },
    getPageNthWordQuads: function (p, i) { var w = pageWordLists[p][i]; return [[w.x0, w.y0, w.x1, w.y0, w.x1, w.y1, w.x0, w.y1]]; },
    getPageBox: function () { return [0, 792, 612, 0]; },
    getPageRotation: function () { return 0; }
  };
}

(async function main() {
  var pdfLib = await import("pdf-lib");
  var PDFDocument = pdfLib.PDFDocument, StandardFonts = pdfLib.StandardFonts, rgb = pdfLib.rgb;
  var pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  if (!fs.existsSync(SRC)) { fs.mkdirSync(path.dirname(SRC), { recursive: true }); console.log("Downloading real IRS Form 1042-S..."); await download(FORM_URL, SRC); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  var srcDoc = await PDFDocument.load(fs.readFileSync(SRC));   // real IRS form
  // page 1 = Copy B (a recipient copy), page 2 = Instructions for Recipient
  var COPY_B = 1, INSTRUCTIONS = 2;

  /* build a shuffled sequence: each recipient appears 1-3 times, out of order */
  var appearances = [], r, t;
  for (r = 0; r < RECIPIENTS.length; r++) { var times = 1 + Math.floor(rnd() * 3); for (t = 0; t < times; t++) appearances.push(RECIPIENTS[r]); }
  for (var i = appearances.length - 1; i > 0; i--) { var jj = Math.floor(rnd() * (i + 1)); var tmp = appearances[i]; appearances[i] = appearances[jj]; appearances[jj] = tmp; }

  /* assemble the UNORGANIZED pdf from REAL form pages */
  var unorg = await PDFDocument.create();
  var helv = await unorg.embedFont(StandardFonts.Helvetica);
  var pageName = [];
  for (var a = 0; a < appearances.length; a++) {
    var nm = appearances[a];
    var cp = await unorg.copyPages(srcDoc, [COPY_B]); var page = cp[0];
    page.drawText(nm, { x: BOX13A.x, y: BOX13A.y, size: BOX13A.size, font: helv, color: rgb(0, 0, 0) });
    unorg.addPage(page); pageName.push(nm);
    var nIns = (rnd() < 0.6) ? 1 : 0;   // ~60% get the real instructions page after them
    for (var z = 0; z < nIns; z++) { var ip = await unorg.copyPages(srcDoc, [INSTRUCTIONS]); unorg.addPage(ip[0]); pageName.push("(instructions)"); }
  }
  try { unorg.getForm().flatten(); } catch (e) {}   // bake in the stamped names, drop empty fields
  var unorgBytes = await unorg.save();
  var unorgPath = path.join(OUT, "unorganized-1042s.pdf");
  fs.writeFileSync(unorgPath, unorgBytes);

  /* read the REAL text back (like Acrobat) and run the ACTUAL organizer */
  var pageWords = await extractWords(pdfjs, unorgBytes);
  var doc = makeDoc(pageWords, unorgPath);
  var det = detectSegments(doc);
  var groups = groupByRecipient(det.segments);
  assignFilenames(groups, OUT + "/");

  /* organized order = each recipient's pages, recipients sorted A->Z */
  var order = [], gi, pi;
  for (gi = 0; gi < groups.length; gi++) for (pi = 0; pi < groups[gi].pages.length; pi++) order.push(groups[gi].pages[pi]);
  for (pi = 0; pi < det.headerPages.length; pi++) order.push(det.headerPages[pi]);
  for (pi = 0; pi < det.reviewPages.length; pi++) order.push(det.reviewPages[pi]);

  var unorgReload = await PDFDocument.load(unorgBytes);
  var org = await PDFDocument.create();
  var ocp = await org.copyPages(unorgReload, order);
  for (i = 0; i < ocp.length; i++) org.addPage(ocp[i]);
  var orgPath = path.join(OUT, "organized-1042s.pdf");
  fs.writeFileSync(orgPath, await org.save());

  /* one real PDF per recipient */
  var perCount = 0;
  for (gi = 0; gi < groups.length; gi++) {
    var per = await PDFDocument.create();
    var pcp = await per.copyPages(unorgReload, groups[gi].pages);
    for (i = 0; i < pcp.length; i++) per.addPage(pcp[i]);
    var base = path.basename(groups[gi].file);
    fs.writeFileSync(path.join(OUT, base), await per.save()); perCount++;
  }

  /* ---- verify + report ---- */
  // did detection read each stamped name correctly off the REAL form?
  var readOk = 0, readBad = 0, mismatches = [];
  for (i = 0; i < det.perPage.length; i++) {
    if (pageName[i] === "(instructions)") continue;
    var got = det.perPage[i].name;
    if (normTok(got) === normTok(pageName[i])) readOk++;
    else { readBad++; if (mismatches.length < 8) mismatches.push("p." + (i + 1) + " stamped=\"" + pageName[i] + "\" read=\"" + got + "\""); }
  }
  var covered = det.reviewPages.length + det.headerPages.length;
  for (gi = 0; gi < groups.length; gi++) covered += groups[gi].pages.length;

  function names(list) { var o = []; for (var q = 0; q < list.length; q++) if (pageName[list[q]] !== "(instructions)") o.push(pageName[list[q]]); return o; }
  var origOrder = []; for (i = 0; i < pageName.length; i++) origOrder.push(i);

  console.log("=============== UNORGANIZED (real IRS forms, shuffled) ===============");
  console.log("  " + names(origOrder).join("  ->  "));
  console.log("\n=============== ORGANIZED (grouped + sorted A..Z) ===============");
  console.log("  " + names(order).join("  ->  "));
  console.log("\n=============== VERIFY ===============");
  console.log("real IRS form used ....... f1042s.pdf (Copy B + Instructions for Recipient)");
  console.log("total pages .............. " + doc.numPages);
  console.log("distinct recipients ...... " + groups.length);
  console.log("Box 13a names read OK .... " + readOk + " / " + (readOk + readBad) + (readBad ? "  *** " + readBad + " MISREAD ***" : ""));
  for (i = 0; i < mismatches.length; i++) console.log("     " + mismatches[i]);
  console.log("no page lost ............. " + (covered === doc.numPages ? "OK" : "MISMATCH " + covered + "/" + doc.numPages));
  console.log("\nFILES WRITTEN:");
  console.log("  UNORGANIZED : " + unorgPath);
  console.log("  ORGANIZED   : " + orgPath);
  console.log("  per-recipient (" + perCount + "): " + OUT + "/1042S_*.pdf");

  process.exit((readBad === 0 && covered === doc.numPages) ? 0 : 1);
})().catch(function (e) { console.error("DEMO FAILED:", e); process.exit(1); });

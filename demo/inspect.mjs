/* Inspect the real IRS Form 1042-S: pages, form fields, and where Box 13a/13b/13c sit. */
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ensureForm } from "./assets.mjs";

const bytes = fs.readFileSync(await ensureForm("f1042s.pdf"));

// ---- pdf-lib: pages + form fields ----
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
console.log("pages:", doc.getPageCount());
doc.getPages().forEach((p, i) => { const { width, height } = p.getSize(); console.log(`  page ${i}: ${Math.round(width)} x ${Math.round(height)}`); });

let form;
try { form = doc.getForm(); } catch (e) { form = null; }
if (form) {
  const fields = form.getFields();
  console.log("form fields:", fields.length);
  // show a few field names
  fields.slice(0, 12).forEach(f => console.log("   field:", f.getName(), "(" + f.constructor.name + ")"));
} else console.log("no AcroForm");

// ---- pdfjs: find 13a/13b/13c labels + positions per page ----
const data = new Uint8Array(bytes);
const pdf = await getDocument({ data, useSystemFonts: true }).promise;
console.log("\npdfjs pages:", pdf.numPages);
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const tc = await page.getTextContent();
  const hits = [];
  for (const it of tc.items) {
    const s = (it.str || "").trim();
    if (/^13[abc]\b/.test(s) || /Recipient'?s\s+name/i.test(s) || /^Copy [A-E]/.test(s)) {
      hits.push(`"${s}" @(${Math.round(it.transform[4])},${Math.round(it.transform[5])})`);
    }
  }
  if (hits.length) console.log(`page ${p - 1}:`, hits.slice(0, 8).join("  "));
}

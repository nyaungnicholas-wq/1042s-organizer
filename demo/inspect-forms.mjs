/* Find, on each real IRS form, the form signature and the recipient/employee name box. */
import fs from "fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ensureForm } from "./assets.mjs";

const FORMS = {
  "1099-NEC": "f1099nec.pdf",
  "W-2": "fw2.pdf",
  "1042": "f1042.pdf",
};
const LABELS = /recipient'?s\s+name|payer'?s\s+name|employee'?s\s+(first|name)|name\s+of\s+withholding\s+agent|withholding\s+agent'?s\s+name|1099|1042|W-2|Wage and Tax/i;

for (const [id, file] of Object.entries(FORMS)) {
  const bytes = fs.readFileSync(await ensureForm(file));
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  console.log(`\n===== ${id}  (${file}, ${pdf.numPages} pages) =====`);
  for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const hits = [];
    for (const it of tc.items) {
      const s = (it.str || "").trim();
      if (s && LABELS.test(s)) hits.push(`"${s}" @(${Math.round(it.transform[4])},${Math.round(it.transform[5])})`);
    }
    if (hits.length) console.log(`  page ${p - 1}:`, hits.slice(0, 10).join("  "));
  }
}

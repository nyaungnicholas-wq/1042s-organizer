/* Self-healing IRS form loader for the demo/inspect scripts.
   Returns the local path to a blank IRS form, downloading it from irs.gov the
   first time so a fresh `git clone` reproduces everything with no manual setup.
   (The PDFs themselves are gitignored — they are fetched on demand.) */
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");
const BASE = "https://www.irs.gov/pub/irs-pdf/";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        file.close(); try { fs.unlinkSync(dest); } catch (e) {}
        return download(r.headers.location, dest).then(resolve, reject);
      }
      if (r.statusCode !== 200) { file.close(); try { fs.unlinkSync(dest); } catch (e) {} return reject(new Error("HTTP " + r.statusCode + " for " + url)); }
      r.pipe(file); file.on("finish", () => file.close(resolve));
    }).on("error", (e) => { try { fs.unlinkSync(dest); } catch (e2) {} reject(e); });
  });
}

/* ensureForm("f1099nec.pdf") -> local path, downloading from irs.gov if missing */
export async function ensureForm(file) {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  const dest = path.join(DIR, file);
  if (!fs.existsSync(dest)) { console.log("Downloading IRS " + file + " ..."); await download(BASE + file, dest); }
  return dest;
}

/* formBytes("fw2.pdf") -> Buffer of the (downloaded-if-needed) form */
export async function formBytes(file) { return fs.readFileSync(await ensureForm(file)); }

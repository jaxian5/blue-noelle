/* Pure Phase 5 archive assembler shared by Edge Runtime and fixture tests. */
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
export type Source = {
 key:string;name:string;owner:string;version:number;size:number;
 mime:string;sha256?:string|null;file_id:string;
};
export const MAX_SOURCE_BYTES=20*1024*1024;
export const MAX_OUTPUT_BYTES=24*1024*1024;
export const MAX_FILES=48;
export function clean(value: string, fallback: string, max = 75): string {
  const v = String(value || "").normalize("NFKD").replace(/[^A-Za-z0-9_. -]/g, "_")
    .replace(/\.\./g, "_").replace(/^[. ]+|[. ]+$/g, "").trim().slice(0, max);
  return v || fallback;
}
export function filenameForSource(file: Source, index: number): string {
  const folder = String(index + 1).padStart(3, "0") + "_" +
    clean(file.owner, "Student") + "_v" + Number(file.version);
  return folder + "/" + clean(file.name, "attachment", 90);
}
export async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function buildPdf(files: { source: Source; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < files.length; i++) {
    const { source, bytes } = files[i];
    if (source.mime !== "application/pdf") {
      throw new Error("PDF_ONLY");
    }
    // A title sheet separates each source. Text is sanitized to the built-in
    // font's encoding; original page content remains unchanged.
    const cover = doc.addPage([595.28, 841.89]);
    cover.drawText("BLUE NOELLE / PHASE 5 COMPILATION", {
      x: 45, y: 780, font, size: 14, color: rgb(0.11, 0.24, 0.51),
    });
    const title = clean(source.name, "Submission document", 65);
    const owner = clean(source.owner, "Student", 65);
    cover.drawText("Source " + (i + 1) + ": " + title, { x: 45, y: 724, font, size: 13 });
    cover.drawText("From: " + owner + " / Version " + Number(source.version),
      { x: 45, y: 696, font, size: 10 });
    const sourcePdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
    const pages = await doc.copyPages(sourcePdf, sourcePdf.getPageIndices());
    for (const page of pages) doc.addPage(page);
  }
  return new Uint8Array(await doc.save({ useObjectStreams: true }));
}
export function buildZip(files: { source: Source; bytes: Uint8Array }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const manifest = files.map(({ source }, index) => ({
    sequence: index + 1, path: filenameForSource(source, index),
    original: source.name, owner: source.owner,
    version: source.version, size: source.size,
  }));
  entries["COMPILATION-MANIFEST.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files.forEach(({ source, bytes }, index) => {
    entries[filenameForSource(source, index)] = bytes;
  });
  return zipSync(entries, { level: 4 });
}

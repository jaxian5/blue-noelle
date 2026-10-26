import assert from "node:assert/strict";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";
import {
  buildPdf,buildZip,hash,filenameForSource,clean,
  MAX_SOURCE_BYTES,MAX_OUTPUT_BYTES,MAX_FILES,
  type Source,
} from "../supabase/functions/bn-phase5-compilation/compile.ts";

const source=(name:string,mime:string,version=1):Source=>({
  key:"private/tests/"+name,name,owner:"QA ../Group",version,mime,
  size:0,file_id:"00000000-0000-0000-0000-000000000001"
});
Deno.test("Two real input PDFs merge with an individual title sheet and all pages intact",async()=>{
  const pdfA=await PDFDocument.create();
  pdfA.addPage([300,400]);
  const pdfB=await PDFDocument.create();
  pdfB.addPage([400,500]);
  pdfB.addPage([500,600]);
  const a=new Uint8Array(await pdfA.save());
  const b=new Uint8Array(await pdfB.save());
  const result=await buildPdf([
    {source:{...source("Lecture 1.pdf","application/pdf"),size:a.length},bytes:a},
    {source:{...source("Lecture 2.pdf","application/pdf",2),size:b.length},bytes:b}
  ]);
  assert.ok(result.length>0);
  const loaded=await PDFDocument.load(result);
  // For 2 source documents, two provenance cover pages + three original pages.
  assert.equal(loaded.getPageCount(),5);
  assert.equal(loaded.getPage(1).getWidth(),300);
  assert.equal(loaded.getPage(4).getWidth(),500);
});
Deno.test("ZIP stores heterogeneous files with an embedded manifest and no traversal",()=>{
  const one=new TextEncoder().encode("text file 1");
  const two=new Uint8Array([0x25,0x50,0x44,0x46]);
  const a=source("../../private/notes.txt","text/plain");
  const b=source("sample.pdf","application/pdf",3);
  const zipped=buildZip([
    {source:{...a,size:one.length},bytes:one},
    {source:{...b,size:two.length},bytes:two}
  ]);
  const files=unzipSync(zipped);
  const names=Object.keys(files);
  assert.equal(names.length,3);
  assert.ok(names.includes("COMPILATION-MANIFEST.json"));
  assert.ok(names.every(name=>!name.includes("../")));
  assert.deepEqual([...files[filenameForSource(a,0)]],[...one]);
  assert.deepEqual([...files[filenameForSource(b,1)]],[...two]);
  const manifest=JSON.parse(strFromU8(files["COMPILATION-MANIFEST.json"]));
  assert.equal(manifest[0].original,a.name);
  assert.equal(manifest[1].version,3);
});
Deno.test("Mixed non-PDF inputs cannot be silently merged into a PDF",async()=>{
  const txt=new TextEncoder().encode("Not a PDF");
  await assert.rejects(()=>buildPdf([
    {source:{...source("report.docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"),size:txt.length},bytes:txt}
  ]),/PDF_ONLY/);
});
Deno.test("Output digests and safety limits are deterministic",async()=>{
  const bytes=new TextEncoder().encode("safe compiled bytes");
  assert.equal(await hash(bytes),"00126d668b73a65c47b599ebf6acd87612bfa9fa1e6f20bab3f7b1c77a2a8bd3"); 
  assert.equal(MAX_SOURCE_BYTES,20971520);
  assert.equal(MAX_OUTPUT_BYTES,25165824);
  assert.equal(MAX_FILES,48);
  assert.ok(clean("../","Fallback").length>0);
});

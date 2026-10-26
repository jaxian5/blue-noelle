// Blue Noelle Phase 5: private PDF/ZIP compilation Edge Function.
// No service key is exposed to browser clients. User-scoped RPC performs
// ACTIVE staff authorization and fixes exact immutable source versions.
// Verify JWT at the Supabase gateway AND check auth.getUser per request.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";

type Source = {
  key: string; name: string; owner: string; version: number; size: number;
  mime: string; sha256?: string | null; file_id: string;
};
type Job = {
  id: string; key: string; format: "pdf" | "zip"; files: Source[];
  file_count: number; source_bytes: number;
};
const BUCKET = "bn-compilations";
const SOURCES = "bn-submissions";
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const MAX_FILES = 48;
const trustedOrigins = new Set(["https://jaxian5.github.io"]);
function headers(origin: string | null): Record<string, string> {
  return {
    ...(origin && trustedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
    "Access-Control-Expose-Headers": "content-disposition",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
}
function json(message: object, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(message), {
    status, headers: { ...headers(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}
function clean(value: string, fallback: string, max = 75): string {
  const v = String(value || "").normalize("NFKD").replace(/[^A-Za-z0-9_. -]/g, "_")
    .replace(/\.\./g, "_").replace(/^[. ]+|[. ]+$/g, "").trim().slice(0, max);
  return v || fallback;
}
function filenameForSource(file: Source, index: number): string {
  const folder = String(index + 1).padStart(3, "0") + "_" +
    clean(file.owner, "Student") + "_v" + Number(file.version);
  return folder + "/" + clean(file.name, "attachment", 90);
}
async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function buildPdf(files: { source: Source; bytes: Uint8Array }[]): Promise<Uint8Array> {
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
function buildZip(files: { source: Source; bytes: Uint8Array }[]): Uint8Array {
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
const MESSAGE: Record<string, string> = {
  PDF_ONLY: "PDF compilation supports PDF submissions only. Choose ZIP for other file types.",
  TOO_LARGE: "The compilation exceeds the maximum allowed file size.",
  MISSING_SOURCE: "A submitted file is unavailable or no longer matches its recorded metadata.",
  INVALID_JOB: "The submitted source manifest could not be verified.",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !trustedOrigins.has(origin)) return json({ error: "Origin not permitted" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  const authHeader = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/.test(authHeader)) return json({ error: "Sign in required" }, 401, origin);
  if (Number(req.headers.get("content-length") || 0) > 4096)
    return json({ error: "Request too large" }, 413, origin);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !secret) return json({ error: "Compilation service is not configured" }, 503, origin);
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const userDb = createClient(url, anon, { global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: authError } = await userDb.auth.getUser(token);
  if (authError || !identity.user) return json({ error: "Session expired" }, 401, origin);
  const server = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > 4096) throw new Error("Request too large");
    body = JSON.parse(text);
  } catch (_) { return json({ error: "Invalid request JSON" }, 400, origin); }
  const action = body.action;
  if (action === "download") {
    const id = body.id;
    if (typeof id !== "string" || !UUID.test(id))
      return json({ error: "Invalid compilation identifier" }, 400, origin);
    const { data: grant, error } = await userDb.rpc("bn_p5_export_access", { p_export: id });
    if (error || !grant?.key || !["pdf", "zip"].includes(grant.format))
      return json({ error: "Compilation unavailable or access denied" }, 403, origin);
    const { data: file, error: storageError } = await server.storage.from(BUCKET).download(grant.key);
    if (storageError || !file) return json({ error: "The generated file is unavailable" }, 404, origin);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== Number(grant.size) || await hash(bytes) !== grant.sha256)
      return json({ error: "Compilation integrity verification failed" }, 409, origin);
    const name = clean(grant.name, "blue-noelle-compilation." + grant.format, 145);
    return new Response(bytes, { status: 200, headers: {
      ...headers(origin), "Content-Type": grant.format === "pdf" ? "application/pdf" : "application/zip",
      "Content-Disposition": 'attachment; filename="' + name + '"',
      "Content-Length": String(bytes.length),
    } });
  }
  if (action !== "build" || typeof body.assignment_id !== "string" ||
      !UUID.test(body.assignment_id) || !["pdf", "zip"].includes(String(body.format)))
    return json({ error: "Specify a valid assignment and PDF or ZIP output" }, 400, origin);

  const { data: raw, error: startError } = await userDb.rpc("bn_p5_export_start", {
    p_assignment: body.assignment_id, p_format: body.format,
  });
  if (startError) return json({ error: startError.message || "Compilation not permitted" }, 403, origin);
  const job = raw as Job;
  if (!job?.id || !UUID.test(job.id) || !Array.isArray(job.files)
      || job.files.length > MAX_FILES || job.files.length !== job.file_count
      || Number(job.source_bytes) > MAX_SOURCE_BYTES) {
    return json({ error: "Invalid compilation source manifest" }, 500, origin);
  }
  let uploaded = false;
  try {
    const parts: { source: Source; bytes: Uint8Array }[] = [];
    let total = 0;
    for (const file of job.files) {
      if (typeof file.key !== "string" || !file.key ||
        Number(file.size) < 1 || Number(file.size) > MAX_SOURCE_BYTES) {
        throw new Error("INVALID_JOB");
      }
      const { data: blob, error } = await server.storage.from(SOURCES).download(file.key);
      if (error || !blob) throw new Error("MISSING_SOURCE");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length !== Number(file.size)) throw new Error("MISSING_SOURCE");
      if (file.sha256 && await hash(bytes) !== String(file.sha256).toLowerCase())
        throw new Error("MISSING_SOURCE");
      total += bytes.length;
      if (total > MAX_SOURCE_BYTES) throw new Error("TOO_LARGE");
      parts.push({ source: file, bytes });
    }
    const output = job.format === "pdf" ? await buildPdf(parts) : buildZip(parts);
    if (!output.length || output.length > MAX_OUTPUT_BYTES) throw new Error("TOO_LARGE");
    const digest = await hash(output);
    const { error: uploadError } = await server.storage.from(BUCKET).upload(job.key,
      new Blob([output], { type: job.format === "pdf" ? "application/pdf" : "application/zip" }),
      { contentType: job.format === "pdf" ? "application/pdf" : "application/zip",
        cacheControl: "0", upsert: false });
    if (uploadError) throw new Error("STORAGE_FAILED");
    uploaded = true;
    const { error: finishError } = await server.rpc("bn_p5_export_finish", {
      p_export: job.id, p_success: true, p_bytes: output.length, p_sha256: digest,
    });
    if (finishError) throw new Error("FINALIZATION_FAILED");
    return json({ id: job.id, format: job.format, status: "READY",
      size: output.length, sha256: digest, file_count: parts.length }, 200, origin);
  } catch (error) {
    if (uploaded) await server.storage.from(BUCKET).remove([job.key]);
    const err = error instanceof Error ? error.message : "GENERATION_FAILED";
    await server.rpc("bn_p5_export_finish", {
      p_export: job.id, p_success: false,
      p_error: MESSAGE[err] ? err : "GENERATION_FAILED",
    });
    // Keep object paths/credentials/internal failures out of browser responses.
    return json({ error: MESSAGE[err] || "Compilation failed. Verify files and retry." }, 422, origin);
  }
});

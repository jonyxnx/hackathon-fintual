import { zipResults } from "@/lib/core/zip";
import type { GeneratorResult } from "@/lib/core/generators";
import {
  ZIP_MAX_BODY_BYTES,
  ZIP_MAX_FILES,
  ZIP_MAX_TOTAL_CHARS,
  unauthorizedResponse,
} from "@/lib/server/apiAuth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const authError = unauthorizedResponse(req);
  if (authError) return authError;

  const rawBody = await req.text();
  if (rawBody.length > ZIP_MAX_BODY_BYTES) {
    return new Response("Request body too large", { status: 413 });
  }

  let body: { files?: Array<{ filename?: string; content?: string }>; name?: string };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const candidates = body.files ?? [];
  if (candidates.length > ZIP_MAX_FILES) {
    return new Response(`Too many files (max ${ZIP_MAX_FILES})`, { status: 413 });
  }

  let totalChars = 0;
  const files: GeneratorResult[] = [];
  for (const file of candidates) {
    if (!file.filename || typeof file.content !== "string") continue;
    totalChars += file.filename.length + file.content.length;
    if (totalChars > ZIP_MAX_TOTAL_CHARS) {
      return new Response("Total content too large", { status: 413 });
    }
    files.push({ filename: file.filename, content: file.content, signals: [] });
  }

  if (files.length === 0) return new Response("No files to zip", { status: 400 });

  const zip = await zipResults(files);
  const safeName = (body.name ?? "kitdoc-docs").replace(/[^\w.-]+/g, "-").slice(0, 80);

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName}.zip"`,
      "Content-Length": String(zip.byteLength),
    },
  });
}

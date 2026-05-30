import { zipResults } from "@/lib/core/zip";
import type { GeneratorResult } from "@/lib/core/generators";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { files?: Array<{ filename?: string; content?: string }>; name?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const files: GeneratorResult[] = (body.files ?? [])
    .filter((file): file is { filename: string; content: string } => Boolean(file.filename && file.content))
    .map((file) => ({ filename: file.filename, content: file.content, signals: [] }));

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

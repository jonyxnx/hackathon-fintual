import { getJob } from "@/lib/server/jobs";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response("Not found or expired", { status: 404 });

  const job = getJob(id);
  if (!job?.zip) return new Response("Not found or expired", { status: 404 });

  return new Response(new Uint8Array(job.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="kitdoc-${id.slice(0, 8)}.zip"`,
      "Content-Length": String(job.zip.byteLength),
    },
  });
}

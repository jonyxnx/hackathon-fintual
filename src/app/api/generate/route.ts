import { zipResults } from "@/lib/core/zip";
import { createJob, setJobArtifact } from "@/lib/server/jobs";
import { unauthorizedResponse } from "@/lib/server/apiAuth";
import type { ProviderName } from "@/lib/core/llm";
import { parseGitHubUrl } from "@/lib/core/url";
import { runWebDocSet } from "@/lib/core/webRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sseLine(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const authError = unauthorizedResponse(req);
  if (authError) return authError;

  let body: { url?: string; provider?: ProviderName };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  if (!body.url) return new Response("Missing url", { status: 400 });

  try {
    parseGitHubUrl(body.url);
  } catch (err) {
    return new Response((err as Error).message, { status: 400 });
  }

  const jobId = createJob();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const sendRaw = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const send = (event: string, data: unknown) => sendRaw(sseLine(event, data));
      const heartbeat = setInterval(() => {
        sendRaw(": ping\n\n");
      }, 10_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
      });

      send("job", { jobId });

      try {
        for await (const evt of runWebDocSet({
          url: body.url!,
          provider: body.provider,
          signal: req.signal,
        })) {
          if (closed || req.signal.aborted) break;
          if (!send(evt.type, evt)) break;
          if (evt.type === "complete") {
            const zip = await zipResults(evt.results);
            setJobArtifact(jobId, zip, evt.results);
            if (!send("download", { jobId, url: `/api/download/${jobId}` })) break;
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          send("error", { error: (err as Error).message ?? String(err) });
        }
      } finally {
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

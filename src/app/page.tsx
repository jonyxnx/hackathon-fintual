"use client";

import { useRef, useState } from "react";
import { UrlForm } from "@/components/UrlForm";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { PixelCat } from "@/components/PixelCat";
import { Starfield } from "@/components/Starfield";
import { ProgressList, type GenStatus } from "@/components/ProgressList";
import {
  MarkdownPreview,
  type MarkdownPreviewHandle,
  type PreviewFile,
} from "@/components/MarkdownPreview";
import { GENERATOR_CATALOG } from "@/lib/core/catalog";
import type { Phase } from "@/lib/core/orchestrator";

type CardStatus = "idle" | "queued" | "running" | "done" | "failed";

interface CardRuntime {
  status: CardStatus;
  signals?: string[];
  bytes?: number;
  error?: string;
}

type UIPhase = Phase | "generating" | "complete" | null;

export default function Home() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<UIPhase>(null);
  const [phaseDetail, setPhaseDetail] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<string | null>(null);
  const [cards, setCards] = useState<Record<string, CardRuntime>>(() =>
    Object.fromEntries(GENERATOR_CATALOG.map((g) => [g.id, { status: "idle" as CardStatus }])),
  );
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<MarkdownPreviewHandle>(null);

  function resetState() {
    setRunning(true);
    setPhase("parsing");
    setPhaseDetail(undefined);
    setTarget(null);
    setCards(
      Object.fromEntries(GENERATOR_CATALOG.map((g) => [g.id, { status: "idle" as CardStatus }])),
    );
    setFiles([]);
    setDownloadUrl(null);
    setError(null);
  }

  async function handleSubmit(url: string, provider: "anthropic" | "openai") {
    resetState();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, provider }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const block of events) {
          const lines = block.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);
          handleEvent(event, data);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(event: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (event === "phase") {
      setPhase(d.phase as Phase);
      setPhaseDetail(d.detail as string | undefined);
    } else if (event === "started") {
      setTarget(`${d.owner}/${d.repo}@${d.ref}`);
      setPhase("generating");
      const gens = d.generators as { id: string; title: string }[];
      const ids = new Set(gens.map((g) => g.id));
      setCards((prev) => {
        const next: Record<string, CardRuntime> = { ...prev };
        for (const id of Object.keys(next)) {
          next[id] = { status: ids.has(id) ? "queued" : "idle" };
        }
        return next;
      });
    } else if (event === "generator:started") {
      const id = d.id as string;
      setCards((prev) => ({ ...prev, [id]: { ...prev[id], status: "running" } }));
    } else if (event === "generator:done") {
      const id = d.id as string;
      const result = d.result as { filename: string; content: string; signals: string[] };
      setCards((prev) => ({
        ...prev,
        [id]: {
          status: "done",
          signals: result.signals,
          bytes: new TextEncoder().encode(result.content).byteLength,
        },
      }));
      setFiles((fs) => [...fs, { filename: result.filename, content: result.content }]);
    } else if (event === "generator:failed") {
      const id = d.id as string;
      setCards((prev) => ({
        ...prev,
        [id]: { status: "failed", error: d.error as string },
      }));
    } else if (event === "complete") {
      setPhase("complete");
    } else if (event === "download") {
      setDownloadUrl(d.url as string);
    } else if (event === "error") {
      setError(d.error as string);
      setPhase(null);
    }
  }

  const progressRows = GENERATOR_CATALOG.map((generator) => {
    const card = cards[generator.id] ?? { status: "idle" as CardStatus };
    const status: GenStatus =
      card.status === "done" || card.status === "running" || card.status === "failed"
        ? card.status
        : "pending";

    return {
      id: generator.id,
      title: generator.title,
      status,
      error: card.error,
      signals: card.signals,
    };
  });
  const showProgress = Boolean(phase || files.length > 0 || error);
  const isLandingView = !showProgress && !downloadUrl && files.length === 0;

  return (
    <div className="relative min-h-screen overflow-hidden">
      <Starfield count={120} />

      <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-6 pt-4 sm:px-6 sm:pt-6">
        <div
          className={`flex flex-1 flex-col gap-4 sm:gap-5 ${isLandingView ? "justify-center" : "pt-2"}`}
        >
          <header className="w-full p-4 sm:p-5 md:p-6">
            <div className="flex w-full flex-col gap-4 sm:gap-5 lg:flex-row lg:items-center lg:gap-6 xl:gap-8">
              <div className="shrink-0">
                <PixelCat size="md" />
              </div>

              <div className="min-w-0 w-full flex-1">
                <h2 className="text-lg font-bold leading-snug tracking-tight text-stone-950 sm:text-xl md:text-2xl">
                  Turn repo context into Notion-ready documentation for every PR.
                </h2>
                <p className="mt-2 w-full text-sm leading-6 text-stone-600 sm:text-base">
                  Paste a GitHub repository URL and get full, in-depth documentation for your
                  project — overview, setup, testing, deployment, conventions, and migrations.
                </p>
              </div>
            </div>
          </header>

          <section className="rounded-3xl border border-stone-200 bg-white/85 p-4 shadow-lg shadow-stone-200/50 backdrop-blur sm:p-5">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                  Start a handoff
                </p>
                <h2 className="text-lg font-black tracking-tight text-stone-950">
                  Generate project documentation
                </h2>
              </div>
              <p className="text-sm text-stone-500">
                Works with public GitHub repositories.
              </p>
            </div>
            <UrlForm disabled={running} onSubmit={handleSubmit} />
          </section>
        </div>

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-4">
            {phase && (
              <PhaseIndicator phase={phase} detail={phaseDetail} target={target} />
            )}

            {showProgress && (
              <section className="rounded-3xl border border-stone-200 bg-white/85 p-4 shadow-sm backdrop-blur sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                      Live run
                    </p>
                    <h2 className="text-lg font-black tracking-tight text-stone-950">
                      Generator progress
                    </h2>
                  </div>
                  {target && (
                    <span className="truncate rounded-full bg-stone-100 px-3 py-1 font-mono text-xs text-stone-600">
                      {target}
                    </span>
                  )}
                </div>
                <ProgressList rows={progressRows} />
              </section>
            )}
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <strong className="font-semibold">Error: </strong>
            {error}
          </div>
        )}

        {downloadUrl && (
          <div className="flex flex-col gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-emerald-900">Project documentation ready</p>
              <p className="text-sm text-emerald-700">
                {files.length} in-depth markdown files are ready to download and move into Notion.
              </p>
            </div>
            <a
              href={downloadUrl}
              className="rounded-xl bg-yellow-300 px-4 py-2 text-center text-sm font-bold text-stone-900 shadow-sm transition-colors hover:bg-yellow-200"
            >
              Download .zip
            </a>
          </div>
        )}

        {files.length > 0 && (
          <section id="preview" className="flex scroll-mt-8 flex-col gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">
                Preview
              </p>
              <h2 className="text-xl font-black tracking-tight text-stone-950">
                Review before publishing
              </h2>
            </div>
            <MarkdownPreview ref={previewRef} files={files} />
          </section>
        )}

        <footer
          className={`mt-auto flex items-center justify-center text-xs text-stone-500 ${isLandingView ? "pt-4" : "pt-8"}`}
        >
          <span>
            Built at Platanus Build Night by{" "}
            <a
              href="https://github.com/jonyxnx"
              className="underline decoration-dotted text-stone-700"
            >
              @jonyxnx
            </a>
            .
          </span>
        </footer>
      </main>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { UrlForm } from "@/components/UrlForm";
import { PhaseIndicator } from "@/components/PhaseIndicator";
import { PixelCat } from "@/components/PixelCat";
import { MarkdownPreview, type PreviewFile } from "@/components/MarkdownPreview";
import { DocTree, type DocNavItem } from "@/components/DocTree";
import type { Phase } from "@/lib/core/webRun";

type UIPhase = Phase | "generating" | "complete" | null;
type DocStatus = "running" | "done" | "failed";

interface DocRuntime extends DocNavItem {
  content?: string;
  status: DocStatus;
}

export default function Home() {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<UIPhase>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [fileTreeTotal, setFileTreeTotal] = useState(0);
  const [failedDocCount, setFailedDocCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const [docs, setDocs] = useState<Record<string, DocRuntime>>({});
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetState() {
    setRunning(true);
    setPhase("parsing");
    setTarget(null);
    setFileTree([]);
    setFileTreeTotal(0);
    setFailedDocCount(0);
    setDocs({});
    setSelectedDocId(null);
    setDownloadUrl(null);
    setDownloadingZip(false);
    setError(null);
  }

  async function handleSubmit(url: string, provider: "anthropic" | "openai") {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    resetState();

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, provider }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || `Request failed (${res.status})`);
      }

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
          if (!block.trim() || block.startsWith(":")) continue;
          const lines = block.split("\n");
          const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
          const dataLine = lines.find((l) => l.startsWith("data: "))?.slice(6);
          if (!event || !dataLine) continue;
          try {
            handleEvent(event, JSON.parse(dataLine));
          } catch {
            // Ignore malformed SSE chunks.
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleEvent(event: string, data: unknown) {
    const d = data as Record<string, unknown>;
    if (event === "phase") {
      setPhase(d.phase as Phase);
    } else if (event === "repo") {
      setTarget(`${d.owner}/${d.repo}@${d.ref}`);
      setFileTree((d.fileTree as string[]) ?? []);
      setFileTreeTotal((d.fileTreeTotal as number) ?? (d.fileTree as string[])?.length ?? 0);
      setPhase("generating");
    } else if (event === "doc:started") {
      const id = d.id as string;
      setDocs((prev) => ({
        ...prev,
        [id]: docFromEvent(d, "running"),
      }));
      setSelectedDocId((current) => current ?? id);
    } else if (event === "doc:done") {
      const id = d.id as string;
      setDocs((prev) => ({
        ...prev,
        [id]: docFromEvent(d, "done"),
      }));
    } else if (event === "doc:failed") {
      const id = d.id as string;
      setFailedDocCount((count) => count + 1);
      setDocs((prev) => ({
        ...prev,
        [id]: docFromEvent(d, "failed"),
      }));
    } else if (event === "complete") {
      setPhase("complete");
      if (typeof d.failedCount === "number") setFailedDocCount(d.failedCount);
    } else if (event === "download") {
      setDownloadUrl(d.url as string);
    } else if (event === "error") {
      setError(d.error as string);
      setPhase(null);
    }
  }

  const docList = useMemo(() => Object.values(docs), [docs]);
  const doneDocCount = useMemo(() => docList.filter((doc) => doc.status === "done").length, [docList]);
  const currentDocTitle = useMemo(() => docList.find((doc) => doc.status === "running")?.title, [docList]);
  const zipName = useMemo(() => (target ? target.split("@")[0].replace("/", "-") : "kitdoc-docs"), [target]);

  async function handleDownloadZip() {
    if (downloadingZip) return;

    if (downloadUrl) {
      window.location.href = downloadUrl;
      return;
    }

    const files = docList
      .filter((doc) => doc.status === "done" && doc.content)
      .map((doc) => ({ filename: doc.filename, content: doc.content! }));

    if (files.length === 0) return;

    setDownloadingZip(true);
    try {
      const res = await fetch("/api/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files, name: zipName }),
      });
      if (!res.ok) throw new Error("Zip download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${zipName}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloadingZip(false);
    }
  }
  const previewFile = useMemo<PreviewFile | null>(() => {
    const selected = selectedDocId ? docs[selectedDocId] : null;
    if (selected?.status === "failed") {
      return {
        filename: selected.filename,
        content: `# ${selected.title}\n\nThis doc failed to generate.\n\n${selected.error ?? "Unknown error."}`,
      };
    }
    if (!selected?.content) return null;
    return { filename: selected.filename, content: selected.content };
  }, [docs, selectedDocId]);
  const showExplorer = docList.length > 0 || fileTree.length > 0 || Boolean(error);
  const isLandingView = !showExplorer && !running && !downloadUrl;

  return (
    <div className="min-h-screen bg-[#fffdf7]">
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        {isLandingView ? (
          <section className="mx-auto flex flex-1 max-w-3xl flex-col items-center justify-center text-center">
            <PixelCat size="md" />
            <p className="mt-8 text-sm font-medium uppercase tracking-[0.2em] text-stone-400">kitdoc</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-950 sm:text-6xl">
              Small docs for fast repo handoffs.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-stone-600 sm:text-lg">
              Paste a GitHub repo and get concise developer docs, an agent guide, and a readable file map.
            </p>
            <div className="mt-10 w-full rounded-[2rem] border border-stone-200 bg-white/75 p-3 text-left shadow-sm">
              <UrlForm disabled={running} onSubmit={handleSubmit} />
            </div>
          </section>
        ) : (
          <header className="mb-5 flex flex-col gap-4 rounded-[2rem] border border-stone-200 bg-white/75 p-4 shadow-sm lg:flex-row lg:items-center">
            <div className="flex items-center gap-4">
              <PixelCat size="sm" />
              <div>
                <p className="text-sm font-semibold text-stone-950">kitdoc</p>
                <p className="text-sm text-stone-500">{target ?? "Generating concise repo docs"}</p>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="min-w-0 flex-1">
                <UrlForm disabled={running} onSubmit={handleSubmit} />
              </div>
              {doneDocCount > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={downloadingZip}
                  title={downloadUrl ? "Download all docs" : `Download ${doneDocCount} docs so far`}
                  className="shrink-0 rounded-xl border border-stone-300 bg-white px-3 py-2 font-mono text-xs font-semibold text-stone-800 transition-colors hover:bg-stone-50 disabled:opacity-50"
                >
                  {downloadingZip ? "…" : ".zip"}
                </button>
              )}
            </div>
          </header>
        )}

        {!isLandingView && phase && (
          <PhaseIndicator phase={phase} target={target} currentDoc={currentDocTitle} doneCount={doneDocCount} />
        )}

        {error && (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <strong className="font-semibold">Error: </strong>
            {error}
          </div>
        )}

        {failedDocCount > 0 && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {failedDocCount} doc{failedDocCount === 1 ? "" : "s"} failed — download the zip for everything that succeeded.
          </div>
        )}

        {showExplorer && (
          <section className="grid h-[calc(100dvh-13rem)] max-h-[calc(100dvh-13rem)] min-h-[360px] flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
            <DocTree
              docs={docList}
              files={fileTree}
              fileCount={fileTreeTotal || fileTree.length}
              selectedId={selectedDocId}
              onSelect={setSelectedDocId}
            />
            <div className="flex min-h-0 flex-col overflow-hidden">
              <MarkdownPreview file={previewFile} />
            </div>
          </section>
        )}

        <footer className="mt-auto flex items-center justify-center pt-8 text-xs text-stone-500">
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

function docFromEvent(d: Record<string, unknown>, status: DocStatus): DocRuntime {
  return {
    id: d.id as string,
    title: d.title as string,
    filename: d.filename as string,
    icon: d.icon as string,
    kind: d.kind as DocRuntime["kind"],
    status,
    content: d.content as string | undefined,
    error: d.error as string | undefined,
  };
}

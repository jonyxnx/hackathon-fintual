import { documentRepo, WEB_MIN_FOLDER_FILES, type DocSink, type DocTreeEvent } from "./docTree";
import { fetchRepo } from "./fetcher";
import { resolveDepth, type GeneratorResult } from "./generators";
import type { ProviderName } from "./llm";
import { getLLM } from "./llm";
import { RepoContext } from "./context";
import { parseGitHubUrl } from "./url";

export type Phase = "parsing" | "fetching" | "ready";

/** Cap files sent to the browser so large repos don't overwhelm the SSE stream. */
export const WEB_FILE_TREE_LIMIT = 2000;

export type WebDocEvent =
  | { type: "phase"; phase: Phase; detail?: string }
  | {
      type: "repo";
      owner: string;
      repo: string;
      ref: string;
      fileTree: string[];
      fileTreeTotal: number;
    }
  | DocTreeEvent
  | { type: "complete"; results: GeneratorResult[]; failedCount: number }
  | { type: "error"; error: string };

export interface WebRunOptions {
  url: string;
  provider?: ProviderName;
  signal?: AbortSignal;
}

class CollectingSink implements DocSink {
  async ensure(_parentId: string, _title: string, _icon: string, label: string): Promise<string> {
    return label;
  }

  async write(_pageId: string, _markdown: string, _icon: string, _label: string): Promise<void> {}
}

class EventQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T | null) => void> = [];
  private closed = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter(null);
  }

  async shift(): Promise<T | null> {
    const item = this.items.shift();
    if (item) return item;
    if (this.closed) return null;
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

export async function* runWebDocSet(opts: WebRunOptions): AsyncGenerator<WebDocEvent> {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    if (opts.signal?.aborted) return;

    yield { type: "phase", phase: "parsing" };
    const parsed = parseGitHubUrl(opts.url);
    const llm = getLLM(opts.provider);
    const depth = resolveDepth(2);

    yield { type: "phase", phase: "fetching", detail: `${parsed.owner}/${parsed.repo}` };
    const fetched = await fetchRepo(parsed);
    cleanup = fetched.cleanup;
    const ctx = new RepoContext(fetched);

    yield {
      type: "repo",
      owner: ctx.owner,
      repo: ctx.repo,
      ref: ctx.ref,
      fileTree: ctx.fileTree.slice(0, WEB_FILE_TREE_LIMIT),
      fileTreeTotal: ctx.fileTree.length,
    };
    yield { type: "phase", phase: "ready" };

    const results: GeneratorResult[] = [];
    let failedCount = 0;
    const queue = new EventQueue<WebDocEvent>();
    const run = documentRepo({
      ctx,
      llm,
      sink: new CollectingSink(),
      depth,
      parentPageId: "repo",
      fullRun: true,
      minFolderFiles: WEB_MIN_FOLDER_FILES,
      signal: opts.signal,
      onEvent: (event) => {
        queue.push(event);
        if (event.type === "doc:done" && event.result) results.push(event.result);
        if (event.type === "doc:failed") failedCount += 1;
      },
    })
      .then(() => {
        queue.push({ type: "complete", results, failedCount });
      })
      .catch((err) => {
        if (opts.signal?.aborted) return;
        queue.push({ type: "error", error: (err as Error).message ?? String(err) });
      })
      .finally(() => queue.close());

    for (;;) {
      if (opts.signal?.aborted) break;
      const event = await queue.shift();
      if (!event) break;
      yield event;
    }
    await run;
  } catch (err) {
    if (!opts.signal?.aborted) {
      yield { type: "error", error: (err as Error).message ?? String(err) };
    }
  } finally {
    if (cleanup) {
      try {
        await cleanup();
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

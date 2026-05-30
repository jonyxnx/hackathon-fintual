import { documentRepo, WEB_MIN_FOLDER_FILES, type DocSink, type DocTreeEvent } from "./docTree";
import { fetchRepo } from "./fetcher";
import { resolveDepth, type GeneratorResult } from "./generators";
import type { ProviderName } from "./llm";
import { getLLM } from "./llm";
import { RepoContext } from "./context";
import { parseGitHubUrl } from "./url";

export type Phase = "parsing" | "fetching" | "ready";

export type WebDocEvent =
  | { type: "phase"; phase: Phase; detail?: string }
  | { type: "repo"; owner: string; repo: string; ref: string; fileTree: string[] }
  | DocTreeEvent
  | { type: "complete"; results: GeneratorResult[] }
  | { type: "error"; error: string };

export interface WebRunOptions {
  url: string;
  provider?: ProviderName;
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
    yield { type: "phase", phase: "parsing" };
    const parsed = parseGitHubUrl(opts.url);
    const llm = getLLM(opts.provider);
    const depth = resolveDepth(2);

    yield { type: "phase", phase: "fetching", detail: `${parsed.owner}/${parsed.repo}` };
    const fetched = await fetchRepo(parsed);
    cleanup = fetched.cleanup;
    const ctx = new RepoContext(fetched);

    yield { type: "repo", owner: ctx.owner, repo: ctx.repo, ref: ctx.ref, fileTree: ctx.fileTree };
    yield { type: "phase", phase: "ready" };

    const results: GeneratorResult[] = [];
    const queue = new EventQueue<WebDocEvent>();
    const run = documentRepo({
      ctx,
      llm,
      sink: new CollectingSink(),
      depth,
      parentPageId: "repo",
      fullRun: true,
      minFolderFiles: WEB_MIN_FOLDER_FILES,
      onEvent: (event) => {
        queue.push(event);
        if (event.type === "doc:done" && event.result) results.push(event.result);
      },
    })
      .then(() => {
        queue.push({ type: "complete", results });
      })
      .catch((err) => {
        queue.push({ type: "error", error: (err as Error).message ?? String(err) });
      })
      .finally(() => queue.close());

    for (;;) {
      const event = await queue.shift();
      if (!event) break;
      yield event;
    }
    await run;
  } catch (err) {
    yield { type: "error", error: (err as Error).message ?? String(err) };
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

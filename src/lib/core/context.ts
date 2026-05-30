import fg from "fast-glob";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { FetchedRepo, RepoMetadata } from "./fetcher";

export interface LocalRepoContextOptions {
  owner: string;
  repo: string;
  ref?: string;
  metadata?: Partial<RepoMetadata>;
}

export class RepoContext {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly tempDir: string;
  readonly fileTree: string[];
  readonly metadata: RepoMetadata;

  constructor(fetched: FetchedRepo) {
    this.owner = fetched.parsed.owner;
    this.repo = fetched.parsed.repo;
    this.ref = fetched.parsed.ref;
    this.tempDir = fetched.tempDir;
    this.fileTree = fetched.fileTree;
    this.metadata = fetched.metadata;
  }

  static async fromLocalDir(dir: string, opts: LocalRepoContextOptions): Promise<RepoContext> {
    const tempDir = path.resolve(dir);
    const ref = opts.ref ?? "HEAD";
    const fileTree = await fg("**/*", {
      cwd: tempDir,
      dot: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "**/build/**"],
      followSymbolicLinks: false,
    });

    return new RepoContext({
      parsed: { owner: opts.owner, repo: opts.repo, ref },
      tempDir,
      fileTree,
      metadata: {
        defaultBranch: opts.metadata?.defaultBranch ?? ref,
        description: opts.metadata?.description ?? null,
        language: opts.metadata?.language ?? null,
        languages: opts.metadata?.languages ?? {},
        stars: opts.metadata?.stars ?? 0,
        topics: opts.metadata?.topics ?? [],
        license: opts.metadata?.license ?? null,
      },
      cleanup: async () => {},
    });
  }

  abs(p: string): string {
    return path.join(this.tempDir, p);
  }

  async exists(p: string): Promise<boolean> {
    try {
      await stat(this.abs(p));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(p: string, maxBytes = 64 * 1024): Promise<string> {
    const filePath = this.abs(p);
    const handle = await open(filePath, "r");
    try {
      const info = await handle.stat();
      const toRead = Math.min(info.size, maxBytes);
      const buf = Buffer.alloc(toRead);
      if (toRead > 0) await handle.read(buf, 0, toRead, 0);
      const text = buf.toString("utf8");
      if (info.size > maxBytes) {
        return text + `\n\n[... truncated, ${info.size - maxBytes} bytes omitted ...]`;
      }
      return text;
    } finally {
      await handle.close();
    }
  }

  async readJson<T = unknown>(p: string): Promise<T | null> {
    try {
      const txt = await this.readFile(p);
      return JSON.parse(txt) as T;
    } catch {
      return null;
    }
  }

  async glob(patterns: string | string[], opts?: { dot?: boolean }): Promise<string[]> {
    const matches = await fg(patterns, {
      cwd: this.tempDir,
      dot: opts?.dot ?? true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "**/build/**"],
      followSymbolicLinks: false,
    });
    return matches;
  }

  async findFiles(patterns: string[], limit = 50): Promise<string[]> {
    const found = new Set<string>();
    for (const pattern of patterns) {
      const matches = await this.glob(pattern);
      for (const match of matches) found.add(match);
      if (found.size >= limit) break;
    }
    return [...found].sort().slice(0, limit);
  }

  sampleSourceFiles(limit = 8): string[] {
    const sourceExts = new Set([
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".rb",
      ".go",
      ".rs",
      ".java",
      ".kt",
      ".swift",
      ".php",
      ".css",
      ".scss",
    ]);
    const testLike = /(^|\/)(__tests__|test|tests|spec|fixtures|mocks)(\/|$)|\.(test|spec)\./;
    const preferredDirs = /^(src|app|lib|components|pages|server|client|api)\//;

    return this.fileTree
      .filter((file) => sourceExts.has(path.extname(file)))
      .filter((file) => !testLike.test(file))
      .sort((a, b) => {
        const aPreferred = preferredDirs.test(a) ? 0 : 1;
        const bPreferred = preferredDirs.test(b) ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
        return a.length - b.length || a.localeCompare(b);
      })
      .slice(0, limit);
  }

  topDirs(): string[] {
    const set = new Set<string>();
    for (const f of this.fileTree) {
      const idx = f.indexOf("/");
      if (idx > 0) set.add(f.slice(0, idx));
    }
    return [...set].sort();
  }

  filesInDir(dir: string): string[] {
    const normalized = dir.replace(/^\/+|\/+$/g, "");
    return this.fileTree
      .filter((file) => file === normalized || file.startsWith(`${normalized}/`))
      .sort();
  }

  fileTreePreview(maxEntries = 200): string {
    const list = this.fileTree.slice(0, maxEntries);
    const more = this.fileTree.length - list.length;
    return list.join("\n") + (more > 0 ? `\n... (${more} more files)` : "");
  }
}

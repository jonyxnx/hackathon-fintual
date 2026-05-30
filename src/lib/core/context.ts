import fg from "fast-glob";
import { readFile as fsReadFile, stat } from "node:fs/promises";
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
    const buf = await fsReadFile(this.abs(p));
    if (buf.byteLength <= maxBytes) return buf.toString("utf8");
    return buf.subarray(0, maxBytes).toString("utf8") + `\n\n[... truncated, ${buf.byteLength - maxBytes} bytes omitted ...]`;
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

  async findFirst(patterns: string[]): Promise<string | null> {
    for (const pattern of patterns) {
      const matches = await this.glob(pattern);
      if (matches.length > 0) return matches[0];
    }
    return null;
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

  /**
   * Every directory that contains at least one file, including nested ones.
   * Used to document the whole repository, not just top-level folders.
   */
  allDirs(maxDepth = 4): string[] {
    const set = new Set<string>();
    for (const f of this.fileTree) {
      const parts = f.split("/");
      // Drop the filename; walk every ancestor directory up to maxDepth.
      for (let i = 1; i < parts.length && i <= maxDepth; i++) {
        set.add(parts.slice(0, i).join("/"));
      }
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

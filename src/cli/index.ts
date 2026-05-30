#!/usr/bin/env -S node --import tsx

import path from "node:path";
import process from "node:process";
import simpleGit from "simple-git";
import { RepoContext } from "../lib/core/context";
import { changedTopDirs } from "../lib/core/diff";
import {
  generateAgentsDoc,
  generateFolderAgentsDoc,
  type DocManifest,
  type DocManifestEntry,
} from "../lib/core/generators/agent";
import { folderGenerator } from "../lib/core/generators/folder";
import { generateFileDoc, isDocumentableFile } from "../lib/core/generators/file";
import { AGENTS_ICON, REPO_ICON, iconForFile, iconForPath } from "../lib/core/icons";
import { getLLM, type LLMProvider, type ProviderName } from "../lib/core/llm";
import { createNotionDocsFromEnv, type NotionDocs } from "../lib/core/notion";

interface CliOptions {
  dir: string;
  base?: string;
  head?: string;
  owner?: string;
  repo?: string;
  provider?: ProviderName;
  all: boolean;
  dryRun: boolean;
  maxFiles: number;
}

const DEFAULT_MAX_FILES = 300;

function usage(): string {
  return `Usage: kitdoc [options]

Options:
  --dir <path>       Local repository path (default: cwd)
  --base <ref>       Base git ref for changed-folder detection
  --head <ref>       Head git ref for changed-folder detection
  --owner <owner>    Repository owner (default: parsed from origin remote)
  --repo <repo>      Repository name (default: parsed from origin remote)
  --provider <name>  LLM provider: anthropic or openai
  --all              Document the whole repository (every folder and file)
  --max-files <n>    Max number of per-file doc pages (default: ${DEFAULT_MAX_FILES})
  --dry-run          Print generated markdown instead of syncing to Notion
  --help             Show this help message`;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseProvider(value: string): ProviderName {
  if (value === "anthropic" || value === "openai") return value;
  throw new Error(`Unsupported --provider value: ${value}. Expected "anthropic" or "openai".`);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dir: process.cwd(),
    all: false,
    dryRun: false,
    maxFiles: DEFAULT_MAX_FILES,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--dir":
        opts.dir = readValue(argv, i, arg);
        i++;
        break;
      case "--base":
        opts.base = readValue(argv, i, arg);
        i++;
        break;
      case "--head":
        opts.head = readValue(argv, i, arg);
        i++;
        break;
      case "--owner":
        opts.owner = readValue(argv, i, arg);
        i++;
        break;
      case "--repo":
        opts.repo = readValue(argv, i, arg);
        i++;
        break;
      case "--provider":
        opts.provider = parseProvider(readValue(argv, i, arg));
        i++;
        break;
      case "--all":
        opts.all = true;
        break;
      case "--max-files": {
        const raw = readValue(argv, i, arg);
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`--max-files requires a non-negative integer, got: ${raw}`);
        }
        opts.maxFiles = parsed;
        i++;
        break;
      }
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return opts;
}

function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[#?].*)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function defaultRepoIdentity(dir: string): Promise<{ owner: string; repo: string }> {
  const git = simpleGit(dir);
  const remoteOutput = await git.remote(["get-url", "origin"]);
  const remoteUrl = typeof remoteOutput === "string" ? remoteOutput.trim() : "";
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error("Could not infer --owner/--repo from origin remote. Pass both flags explicitly.");
  }
  return parsed;
}

function assertDiffArgs(opts: CliOptions): asserts opts is CliOptions & { base: string; head: string } {
  if (opts.all) return;
  if (!opts.base || !opts.head) {
    throw new Error("--base and --head are required unless --all is set.");
  }
}

function printDryRun(folder: string, markdown: string): void {
  console.log(`\n--- kitdoc dry-run: ${folder} ---\n`);
  console.log(markdown);
  console.log(`\n--- end ${folder} ---`);
}

interface DirNode {
  path: string;
  name: string;
  dirs: Map<string, DirNode>;
  files: string[];
}

function buildTree(files: string[], roots?: string[]): DirNode {
  const root: DirNode = { path: "", name: "", dirs: new Map(), files: [] };
  for (const file of files) {
    if (roots && !roots.some((r) => file === r || file.startsWith(`${r}/`))) continue;
    const parts = file.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const childPath = node.path ? `${node.path}/${seg}` : seg;
      let child = node.dirs.get(seg);
      if (!child) {
        child = { path: childPath, name: seg, dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

/** Abstracts writing a page so the same walk drives both Notion and --dry-run. */
interface DocSink {
  upsert(parentId: string, title: string, markdown: string, icon: string, label: string): Promise<string>;
}

class NotionSink implements DocSink {
  constructor(private readonly notion: NotionDocs) {}

  async upsert(parentId: string, title: string, markdown: string, icon: string, label: string): Promise<string> {
    const page = await this.notion.upsertMarkdownPage(parentId, title, markdown, icon);
    console.log(`${page.created ? "Created" : "Updated"} ${label} (${icon}).`);
    return page.id;
  }
}

class DryRunSink implements DocSink {
  async upsert(_parentId: string, _title: string, markdown: string, icon: string, label: string): Promise<string> {
    printDryRun(`${icon} ${label}`, markdown);
    return "";
  }
}

interface WalkState {
  ctx: RepoContext;
  llm: LLMProvider;
  sink: DocSink;
  manifest: DocManifest;
  remainingFiles: number;
}

async function documentFolder(node: DirNode, parentPageId: string, state: WalkState): Promise<void> {
  const { ctx, llm, sink } = state;
  const icon = iconForPath(node.path);

  console.log(`Generating folder doc: ${node.path}`);
  const folderDoc = await folderGenerator(node.path).run(ctx, llm);
  const folderPageId = await sink.upsert(parentPageId, node.name, folderDoc.content, icon, node.path);
  state.manifest.documented.push({ path: node.path, kind: "folder" });

  const folderAgents = await generateFolderAgentsDoc(node.path, ctx, llm);
  await sink.upsert(folderPageId, "AGENTS.md", folderAgents.content, AGENTS_ICON, `${node.path}/AGENTS.md`);

  await documentFilesAndSubdirs(node, folderPageId, state);
}

async function documentFilesAndSubdirs(node: DirNode, pageId: string, state: WalkState): Promise<void> {
  const { ctx, llm, sink } = state;

  for (const file of node.files.sort()) {
    if (!isDocumentableFile(file)) {
      state.manifest.skipped.push(file);
      continue;
    }
    if (state.remainingFiles <= 0) {
      state.manifest.skipped.push(file);
      continue;
    }
    state.remainingFiles -= 1;

    console.log(`Generating file doc: ${file}`);
    const fileDoc = await generateFileDoc(file, ctx, llm);
    const title = file.split("/").pop() ?? file;
    await sink.upsert(pageId, title, fileDoc.content, iconForFile(file), file);
    state.manifest.documented.push({ path: file, kind: "file" });
  }

  for (const child of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    await documentFolder(child, pageId, state);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(opts.dir);
  const identity = opts.owner && opts.repo ? { owner: opts.owner, repo: opts.repo } : await defaultRepoIdentity(dir);

  assertDiffArgs(opts);

  const ctx = await RepoContext.fromLocalDir(dir, {
    owner: identity.owner,
    repo: identity.repo,
    ref: opts.head ?? "HEAD",
  });

  const changedRoots = opts.all ? null : await changedTopDirs(dir, opts.base, opts.head);
  const llm = getLLM(opts.provider);
  const notionTarget = opts.dryRun ? null : createNotionDocsFromEnv();
  const repoPage = notionTarget
    ? await notionTarget.notion.ensureRepoPage(
        notionTarget.parentPageId,
        `${identity.owner}/${identity.repo}`,
        REPO_ICON,
      )
    : null;

  if (!opts.dryRun && (!notionTarget || !repoPage)) {
    throw new Error("Notion target was not initialized.");
  }

  const repoPageId = repoPage?.id ?? "";
  const sink: DocSink = notionTarget ? new NotionSink(notionTarget.notion) : new DryRunSink();

  const state: WalkState = {
    ctx,
    llm,
    sink,
    manifest: { documented: [], skipped: [] },
    remainingFiles: opts.maxFiles,
  };

  // For --all, document the whole repo (every folder + file, including root files).
  // For changed mode, restrict to the changed top-level folders.
  const tree = buildTree(ctx.fileTree, changedRoots ?? undefined);
  const hasContent = tree.files.length > 0 || tree.dirs.size > 0;

  if (!hasContent) {
    console.log("No files or folders to document.");
  } else {
    const scope = opts.all ? "whole repository" : `changed folders: ${(changedRoots ?? []).join(", ")}`;
    console.log(`Documenting ${scope} (every folder and file, page-in-page).`);
    await documentFilesAndSubdirs(tree, repoPageId, state);
  }

  // AGENTS.md is generated LAST so it can index everything that was produced and
  // report on coverage and gaps.
  console.log("Generating AGENTS.md (documentation index + coverage)...");
  const agentsDoc = await generateAgentsDoc(ctx, llm, state.manifest);
  await sink.upsert(repoPageId, "AGENTS.md", agentsDoc.content, AGENTS_ICON, "AGENTS.md");

  const docCount = state.manifest.documented.length;
  const fileCount = state.manifest.documented.filter((e: DocManifestEntry) => e.kind === "file").length;
  console.log(
    `Done. Documented ${docCount} pages (${fileCount} files), skipped ${state.manifest.skipped.length} files.`,
  );
}

main().catch((err) => {
  console.error((err as Error).message ?? String(err));
  process.exit(1);
});

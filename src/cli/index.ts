#!/usr/bin/env -S node --import tsx

import path from "node:path";
import process from "node:process";
import simpleGit from "simple-git";
import { RepoContext } from "../lib/core/context";
import { changedTopDirs } from "../lib/core/diff";
import {
  generateAgentsDoc,
  type DocManifest,
} from "../lib/core/generators/agent";
import { folderGenerator } from "../lib/core/generators/folder";
import { isDocumentableFile } from "../lib/core/generators/file";
import { setup } from "../lib/core/generators/setup";
import { deployment } from "../lib/core/generators/deployment";
import { conventions } from "../lib/core/generators/conventions";
import { improvements } from "../lib/core/generators/improvements";
import type { Generator } from "../lib/core/generators";
import { AGENTS_ICON, REPO_ICON, iconForPath } from "../lib/core/icons";
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
  minFolderFiles: number;
}

/** A folder needs at least this many documentable files (in its subtree) to get its own page. */
const DEFAULT_MIN_FOLDER_FILES = 3;
/** A folder this large (or with this many subfolders) gets a deeper, concern-split doc. */
const BIG_FOLDER_FILES = 12;
const BIG_FOLDER_SUBDIRS = 4;

/**
 * Root-level documents written directly on the repo page. Regenerated on every
 * run (full or incremental) so whole-codebase docs stay current.
 */
const ROOT_DOCS: Array<{ gen: Generator; title: string; icon: string }> = [
  { gen: setup, title: "Local setup", icon: "🧰" },
  { gen: deployment, title: "Deployment", icon: "🚀" },
  { gen: conventions, title: "Codebase patterns", icon: "📐" },
  { gen: improvements, title: "Improvements", icon: "✨" },
];

/** Marker page whose presence on the repo page means the repo was documented before. */
const AGENTS_PAGE_TITLE = "AGENTS.md";

function usage(): string {
  return `Usage: kitdoc [options]

Options:
  --dir <path>       Local repository path (default: cwd)
  --base <ref>       Base git ref for changed-folder detection
  --head <ref>       Head git ref for changed-folder detection
  --owner <owner>    Repository owner (default: parsed from origin remote)
  --repo <repo>      Repository name (default: parsed from origin remote)
  --provider <name>  LLM provider: anthropic or openai
  --all              Document the whole repository (every significant folder)
  --min-folder-files <n>  Min documentable files for a folder to get its own page (default: ${DEFAULT_MIN_FOLDER_FILES})
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
    minFolderFiles: DEFAULT_MIN_FOLDER_FILES,
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
      case "--min-folder-files": {
        const raw = readValue(argv, i, arg);
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 1) {
          throw new Error(`--min-folder-files requires a positive integer, got: ${raw}`);
        }
        opts.minFolderFiles = parsed;
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

/**
 * Abstracts page writing so the same walk drives both Notion and --dry-run.
 * It is two-phase on purpose: `ensure` creates the page (so nested subpages can
 * be created under it first), and `write` fills in the prose afterwards. Because
 * subpages exist before the prose is written, they render at the TOP of the page
 * instead of below all the documentation text.
 */
interface DocSink {
  ensure(parentId: string, title: string, icon: string, label: string): Promise<string>;
  write(pageId: string, markdown: string, icon: string, label: string): Promise<void>;
}

class NotionSink implements DocSink {
  constructor(private readonly notion: NotionDocs) {}

  async ensure(parentId: string, title: string, icon: string, label: string): Promise<string> {
    const page = await this.notion.ensurePage(parentId, title, icon);
    console.log(`${page.created ? "Created" : "Updated"} ${label} (${icon}).`);
    return page.id;
  }

  async write(pageId: string, markdown: string, _icon: string, _label: string): Promise<void> {
    await this.notion.writeMarkdown(pageId, markdown);
  }
}

class DryRunSink implements DocSink {
  async ensure(_parentId: string, _title: string, _icon: string, _label: string): Promise<string> {
    return "";
  }

  async write(_pageId: string, markdown: string, icon: string, label: string): Promise<void> {
    printDryRun(`${icon} ${label}`, markdown);
  }
}

/** Create a leaf doc page and write its content in one step. */
async function writeDoc(
  state: WalkState,
  parentId: string,
  title: string,
  markdown: string,
  icon: string,
  label: string,
): Promise<string> {
  const pageId = await state.sink.ensure(parentId, title, icon, label);
  await state.sink.write(pageId, markdown, icon, label);
  return pageId;
}

interface WalkState {
  ctx: RepoContext;
  llm: LLMProvider;
  sink: DocSink;
  manifest: DocManifest;
  minFolderFiles: number;
}

/**
 * Decide whether to document the whole codebase (first run) or only changed
 * areas (incremental). First run is detected by the absence of the AGENTS.md
 * page on the Notion repo page.
 */
async function resolveFullRun(
  opts: CliOptions,
  notion: NotionDocs | null,
  repoPageId: string,
): Promise<boolean> {
  if (opts.all) return true;
  if (notion && repoPageId) {
    const documentedBefore = await notion.childPageExists(repoPageId, AGENTS_PAGE_TITLE);
    console.log(
      documentedBefore
        ? `Found ${AGENTS_PAGE_TITLE} on the repo page → incremental run (changed areas only).`
        : `No ${AGENTS_PAGE_TITLE} on the repo page → first run, documenting the entire codebase.`,
    );
    return !documentedBefore;
  }
  // Dry-run: full unless base/head were provided (then mimic an incremental run).
  return !(opts.base && opts.head);
}

function countDocumentableFiles(node: DirNode): number {
  let total = node.files.filter(isDocumentableFile).length;
  for (const child of node.dirs.values()) total += countDocumentableFiles(child);
  return total;
}

/** A folder earns its own page when its subtree has enough documentable files. */
function isSignificant(node: DirNode, minFiles: number): boolean {
  return countDocumentableFiles(node) >= minFiles;
}

/** Large or multi-concern folders get a deeper, concern-split doc. */
function isBig(node: DirNode): boolean {
  return countDocumentableFiles(node) >= BIG_FOLDER_FILES || node.dirs.size >= BIG_FOLDER_SUBDIRS;
}

async function documentChildren(node: DirNode, parentPageId: string, state: WalkState): Promise<void> {
  const children = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));

  for (const child of children) {
    if (!isSignificant(child, state.minFolderFiles)) {
      // Too small for its own page: fold it in by attaching any significant
      // descendants to this same parent. Its files are still covered by the
      // nearest documented ancestor's folder doc.
      state.manifest.skipped.push(child.path);
      await documentChildren(child, parentPageId, state);
      continue;
    }

    const deep = isBig(child);
    const icon = iconForPath(child.path);

    // 1. Ensure the page exists so subpages can be created under it.
    const folderPageId = await state.sink.ensure(parentPageId, child.name, icon, child.path);
    state.manifest.documented.push({ path: child.path, kind: "folder", icon });

    // 2. Create nested subpages FIRST so they render above this page's prose.
    await documentChildren(child, folderPageId, state);

    // 3. Write this folder's prose LAST so it lands below the subpages.
    console.log(`Generating folder doc: ${child.path}${deep ? " (deep)" : ""}`);
    const folderDoc = await folderGenerator(child.path, { deep }).run(state.ctx, state.llm);
    await state.sink.write(folderPageId, folderDoc.content, icon, child.path);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(opts.dir);
  const identity = opts.owner && opts.repo ? { owner: opts.owner, repo: opts.repo } : await defaultRepoIdentity(dir);

  const ctx = await RepoContext.fromLocalDir(dir, {
    owner: identity.owner,
    repo: identity.repo,
    ref: opts.head ?? "HEAD",
  });

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

  // First run documents everything; subsequent runs only refresh changed areas.
  const fullRun = await resolveFullRun(opts, notionTarget?.notion ?? null, repoPageId);

  let changedRoots: string[] | null = null;
  if (!fullRun) {
    if (!opts.base || !opts.head) {
      throw new Error("--base and --head are required for an incremental run (or pass --all to force a full run).");
    }
    changedRoots = await changedTopDirs(dir, opts.base, opts.head);
  }

  const state: WalkState = {
    ctx,
    llm,
    sink,
    manifest: { documented: [], skipped: [], rootDocs: [], fullRun },
    minFolderFiles: opts.minFolderFiles,
  };

  // Root-level whole-codebase docs (local setup, deployment, patterns,
  // improvements). Created first so they sit at the TOP of the repo page,
  // above the per-folder pages. Always regenerated so they stay current.
  console.log("Generating root documents (local setup, deployment, patterns, improvements)...");
  for (const { gen, title, icon } of ROOT_DOCS) {
    console.log(`Generating root doc: ${title}...`);
    const doc = await gen.run(ctx, llm);
    await writeDoc(state, repoPageId, title, doc.content, icon, title);
    state.manifest.rootDocs.push({ title, icon });
  }

  // Reserve the AGENTS.md page now (before folder pages) so it stays near the
  // top of the repo page; its content is written last once coverage is known.
  const agentsPageId = await state.sink.ensure(repoPageId, AGENTS_PAGE_TITLE, AGENTS_ICON, AGENTS_PAGE_TITLE);

  // Folder docs. Full run walks the whole repo; incremental restricts to the
  // changed top-level folders (and their significant descendants). Each
  // significant folder gets its own nested page; small folders are folded into
  // their nearest documented ancestor.
  const tree = buildTree(ctx.fileTree, changedRoots ?? undefined);

  if (tree.dirs.size === 0) {
    console.log(fullRun ? "No folders to document." : "No changed folders to document.");
  } else {
    const scope = fullRun ? "whole repository" : `changed folders: ${(changedRoots ?? []).join(", ")}`;
    console.log(`Documenting ${scope} (one doc per significant folder, page-in-page).`);
    await documentChildren(tree, repoPageId, state);
  }

  // AGENTS.md content is written LAST so it can index everything that was
  // produced and report on coverage and gaps. Its page (reserved above) also
  // marks the repo as documented, which makes the next run incremental.
  console.log("Generating AGENTS.md (documentation index + coverage)...");
  const agentsDoc = await generateAgentsDoc(ctx, llm, state.manifest);
  await sink.write(agentsPageId, agentsDoc.content, AGENTS_ICON, AGENTS_PAGE_TITLE);

  console.log(
    `Done (${fullRun ? "full" : "incremental"} run). ${state.manifest.rootDocs.length} root doc(s), ` +
      `${state.manifest.documented.length} folder doc(s), folded ${state.manifest.skipped.length} small folder(s).`,
  );
}

main().catch((err) => {
  console.error((err as Error).message ?? String(err));
  process.exit(1);
});

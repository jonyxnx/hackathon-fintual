#!/usr/bin/env -S node --import tsx

import path from "node:path";
import process from "node:process";
import simpleGit from "simple-git";
import { RepoContext } from "../lib/core/context";
import { changedTopDirs } from "../lib/core/diff";
import {
  AGENTS_PAGE_TITLE,
  DEFAULT_MIN_FOLDER_FILES,
  documentRepo,
  type DocSink,
} from "../lib/core/docTree";
import { ROOT_CHANGE } from "../lib/core/diff";
import { DEFAULT_DEPTH, resolveDepth } from "../lib/core/generators";
import { REPO_ICON } from "../lib/core/icons";
import { getLLM, type ProviderName } from "../lib/core/llm";
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
  depth: number;
}

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
  --depth <1-10>     Documentation depth: 10 = whole repo in detail, 5 = important things (default), 1 = rough idea
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
    depth: DEFAULT_DEPTH,
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
      case "--depth": {
        const raw = readValue(argv, i, arg);
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
          throw new Error(`--depth requires an integer from 1 to 10, got: ${raw}`);
        }
        opts.depth = parsed;
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

/**
 * Abstracts page writing so the same walk drives both Notion and --dry-run.
 * It is two-phase on purpose: `ensure` creates the page (so nested subpages can
 * be created under it first), and `write` fills in the prose afterwards. Because
 * subpages exist before the prose is written, they render at the TOP of the page
 * instead of below all the documentation text.
 */
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
    console.log(documentedBefore ? "Incremental run (changed areas only)." : "First run: documenting the whole repo.");
    return !documentedBefore;
  }
  // Dry-run: full unless base/head were provided (then mimic an incremental run).
  return !(opts.base && opts.head);
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
  const depth = resolveDepth(opts.depth);

  // First run documents everything; subsequent runs only refresh changed areas.
  const fullRun = await resolveFullRun(opts, notionTarget?.notion ?? null, repoPageId);

  let changedRoots: string[] | null = null;
  if (!fullRun) {
    if (!opts.base || !opts.head) {
      throw new Error("--base and --head are required for an incremental run (or pass --all to force a full run).");
    }
    changedRoots = await changedTopDirs(dir, opts.base, opts.head);
  }

  console.log(`Documentation depth: ${depth.level}/10.`);
  if (fullRun) {
    console.log("Documenting whole repository.");
  } else {
    const labels = (changedRoots ?? []).map((dir) => (dir === ROOT_CHANGE ? "root files" : dir));
    console.log(`Documenting changed folders: ${labels.join(", ") || "(none)"}.`);
  }
  const manifest = await documentRepo({
    ctx,
    llm,
    sink,
    depth,
    parentPageId: repoPageId,
    fullRun,
    minFolderFiles: opts.minFolderFiles,
    changedRoots,
  });

  console.log(
    `Done (${fullRun ? "full" : "incremental"} run). ${manifest.rootDocs.length} root doc(s), ` +
      `${manifest.documented.length} folder doc(s), folded ${manifest.skipped.length} small folder(s).`,
  );
}

main().catch((err) => {
  console.error((err as Error).message ?? String(err));
  process.exit(1);
});

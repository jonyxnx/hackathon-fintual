import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import {
  buildFileBlocks,
  depthGuidance,
  scaledContext,
  scaledTokens,
  type DepthConfig,
  type GeneratorResult,
} from "./index";

/**
 * AGENTS.md is the one document written FOR AI coding agents (not human
 * onboarding). It tells an agent what matters, where to look, how to navigate
 * the rest of the docs, and how to change the repo safely.
 */
const AGENT_SYSTEM_PROMPT = `You are writing AGENTS.md: operating instructions for an AI coding agent working in this repository.
Rules:
- Your reader is an autonomous coding agent, not a human doing onboarding. Optimize for fast orientation and safe, correct edits.
- Write ONLY what is supported by the provided files. If something is unknown or absent, say so explicitly. Never invent commands, paths, versions, or behavior.
- Be dense and high-signal, but SHORT: only the essentials an agent needs before touching code (entry points, key files, conventions, hazards, verify commands). Prefer pointers to the other docs over repeating their content.
- Tell the agent which files to open first for each kind of task, what NOT to break, and how to verify a change.
- This file is also the index for the human-facing documentation tree, so explain what other docs exist and when the agent should read them instead of re-deriving context.
- Output GitHub-flavored markdown. No preamble. Start with the requested heading.
- Use flat bullet lists and tables; reference files with backticks and repo-relative paths.`;

const AGENT_CONTEXT_PATTERNS = [
  "**/README.md",
  "**/package.json",
  "**/pyproject.toml",
  "**/Cargo.toml",
  "**/go.mod",
  "**/Makefile",
  "**/.github/workflows/*.{yml,yaml}",
  "**/.github/actions/**/action.{yml,yaml}",
  "**/.env.example",
  "**/tsconfig*.json",
  "**/next.config.*",
  "**/vite.config.*",
];

function fileTreeList(files: string[], maxEntries = 400): string {
  const list = files.slice(0, maxEntries);
  const more = files.length - list.length;
  return list.map((file) => `- \`${file}\``).join("\n") + (more > 0 ? `\n- ... (${more} more files)` : "");
}

export interface DocManifestEntry {
  /** Repo-relative path of the documented file or folder. */
  path: string;
  kind: "folder" | "file";
  /** Emoji icon set on the Notion page for this entry. */
  icon?: string;
}

export interface RootDocEntry {
  title: string;
  icon: string;
}

export interface DocManifest {
  documented: DocManifestEntry[];
  /** Folders considered too small for their own page (folded into a parent doc). */
  skipped: string[];
  /** Root-level documents on the repo page (Local setup, Deployment, Codebase patterns, Improvements). */
  rootDocs: RootDocEntry[];
  /** True when the whole repo was documented; false for an incremental (changed-only) run. */
  fullRun: boolean;
}

function manifestSection(manifest: DocManifest): string {
  const folders = manifest.documented.filter((e) => e.kind === "folder");
  const lines = [
    `Run type: ${manifest.fullRun ? "FULL — entire codebase documented" : "INCREMENTAL — only changed areas refreshed"}`,
    ``,
    `Each documented page below already has the shown emoji icon set in Notion. When you build the documentation index and folder guide, prefix each page name with its emoji so this AGENTS.md mirrors the Notion sidebar.`,
    ``,
    `Root-level documents on the repo page (${manifest.rootDocs.length}):`,
    ...manifest.rootDocs.map((d) => `  - ${d.icon} \`${d.title}\``),
    ``,
    `Folder documentation pages this run (one doc per significant folder, nested page-in-page) (${folders.length}):`,
    ...folders.slice(0, 300).map((f) => `  - ${f.icon ?? "📁"} \`${f.path}\``),
    folders.length > 300 ? `  - ... (${folders.length - 300} more)` : "",
    ``,
    `Small folders folded into a parent doc instead of their own page (${manifest.skipped.length}):`,
    ...manifest.skipped.slice(0, 150).map((f) => `  - \`${f}\``),
    manifest.skipped.length > 150 ? `  - ... (${manifest.skipped.length - 150} more)` : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function generateAgentsDoc(
  ctx: RepoContext,
  llm: LLMProvider,
  manifest?: DocManifest,
  depth?: DepthConfig,
): Promise<GeneratorResult> {
  const contextFiles = await ctx.findFiles(AGENT_CONTEXT_PATTERNS, scaledContext(24, depth, 8));
  const sourceSamples = ctx.sampleSourceFiles(scaledContext(24, depth, 8));
  const paths = [...new Set([...contextFiles, ...sourceSamples])];
  const fileBlocks = await buildFileBlocks(ctx, paths, {
    perFileMax: scaledContext(10 * 1024, depth, 4 * 1024),
    maxFiles: scaledContext(40, depth, 10),
  });
  const topDirs = ctx.topDirs();

  const coverageBlock = manifest
    ? `\n\nDocumentation coverage for this run:\n\n${manifestSection(manifest)}`
    : "";

  const coverageSections = manifest
    ? `
5. \`## Documentation map\` - the other docs and when to read each instead of re-deriving context. List the root docs and the folder pages, prefixing every page name with the exact emoji icon shown in the coverage data above so it matches the Notion sidebar. Note in one line that the first run documents everything and later runs refresh only changed areas.
6. \`## Coverage & gaps\` - from the coverage data, briefly note what's documented and what's still missing or worth expanding (the "what to add next" list). Keep it short.`
    : `
5. \`## Watch out for\` - the key hazards, conventions, and unknowns an agent must respect.`;

  const user = `Write a root **AGENTS.md** file for \`${ctx.owner}/${ctx.repo}\`.

This is written specifically FOR an AI coding agent (the human-facing docs are separate root pages: Local setup, Deployment, Codebase patterns, Improvements, plus per-folder pages). It is the agent's operating guide AND the index for that documentation tree. Keep it short and high-signal — point to the other docs instead of repeating them.

Repo ref: ${ctx.ref}
Top-level directories: ${topDirs.join(", ") || "(none)"}

File index (${ctx.fileTree.length} files, truncated if needed):
${fileTreeList(ctx.fileTree)}

Repository evidence (key files):

${fileBlocks || "(no representative files found)"}${coverageBlock}

Produce a focused AGENTS.md (omit any section with nothing useful):
1. \`# AGENTS.md\` heading.
2. \`## Orientation\` - what this repo is in 1-2 lines and the few files to open first.
3. \`## Where things live\` - a compact table of the important areas only: Area/path | What it does | When to touch. Don't list every file.
4. \`## Working safely\` - the key install/run/test/verify commands and the few rules and hazards an agent must respect.${coverageSections}
${depthGuidance(depth)}`;

  const content = await llm.complete({ system: AGENT_SYSTEM_PROMPT, user, maxTokens: scaledTokens(3500, depth) });
  return { filename: "AGENTS.md", content, signals: paths };
}

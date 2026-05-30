import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import { buildFileBlocks, type GeneratorResult } from "./index";

/**
 * AGENTS.md is the one document written FOR AI coding agents (not human
 * onboarding). It tells an agent what matters, where to look, how to navigate
 * the rest of the docs, and how to change the repo safely.
 */
const AGENT_SYSTEM_PROMPT = `You are writing AGENTS.md: operating instructions for an AI coding agent working in this repository.
Rules:
- Your reader is an autonomous coding agent, not a human doing onboarding. Optimize for fast orientation and safe, correct edits.
- Write ONLY what is supported by the provided files. If something is unknown or absent, say so explicitly. Never invent commands, paths, versions, or behavior.
- Be dense and high-signal: prioritize what an agent must know before touching code (entry points, key files, conventions, hazards, verification commands).
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
): Promise<GeneratorResult> {
  const contextFiles = await ctx.findFiles(AGENT_CONTEXT_PATTERNS, 24);
  const sourceSamples = ctx.sampleSourceFiles(24);
  const paths = [...new Set([...contextFiles, ...sourceSamples])];
  const fileBlocks = await buildFileBlocks(ctx, paths, 10 * 1024);
  const topDirs = ctx.topDirs();

  const coverageBlock = manifest
    ? `\n\nDocumentation coverage for this run:\n\n${manifestSection(manifest)}`
    : "";

  const coverageSections = manifest
    ? `
9. \`## Documentation index\` - explain how the Notion documentation tree is organized: the repo page holds root-level docs (Local setup, Deployment, Codebase patterns, Improvements, this AGENTS.md) plus nested folder pages (one doc per significant folder; small folders are folded into their parent's doc). Render this as a list where every page name is prefixed with the exact emoji icon shown in the coverage data above so it matches the Notion sidebar. Explain how a developer should navigate it, and note that the first run documents everything while later runs refresh only changed areas.
10. \`## Documentation coverage\` - based on the coverage data above, summarize which root docs and folders are documented and which were folded in, and call out any large or multi-concern folder whose doc should be expanded or split.
11. \`## Gaps and recommended additions\` - list specific folders or topics that still need documentation or deeper coverage, and what each doc should contain. This is the "what's missing, add it" section.
12. \`## CI and automation\` - GitHub Actions / Notion sync / deploy hooks when visible.
13. \`## Change safety checklist\` - checks before handing off changes.
14. \`## Unknowns to verify\` - facts not visible from provided files.`
    : `
9. \`## CI and automation\` - GitHub Actions / Notion sync / deploy hooks when visible.
10. \`## Change safety checklist\` - checks before handing off changes.
11. \`## Unknowns to verify\` - facts not visible from provided files.`;

  const user = `Write a root **AGENTS.md** file for \`${ctx.owner}/${ctx.repo}\`.

This document lives on the Notion repo page and is written specifically FOR an AI coding agent (the human-facing docs are separate root pages: Local setup, Deployment, Codebase patterns, Improvements, plus the per-folder pages). It is BOTH the primary operating guide for an agent AND the index for that documentation tree. It must let an agent work fast and safely without reading the entire repository, and it must describe what documentation already exists and what is still missing.

Repo ref: ${ctx.ref}
Top-level directories: ${topDirs.join(", ") || "(none)"}

Complete file index (${ctx.fileTree.length} files, truncated if needed):
${fileTreeList(ctx.fileTree)}

File tree preview:
\`\`\`
${ctx.fileTreePreview(320)}
\`\`\`

Repository evidence (key files):

${fileBlocks || "(no representative files found)"}${coverageBlock}

Produce:
1. \`# AGENTS.md\` heading.
2. \`## How to get oriented fast\` - the fastest path to understand this repo (which files to open first, in order, and why).
3. \`## File index\` - a markdown table with columns: File | Role | When to change | Quick lookup hint. Cover every important file visible in the index; group minor/config files when appropriate but do not skip major source areas.
4. \`## Change map\` - common tasks (bugfix, new API route, UI change, config, tests, deploy, DB) mapped to exact files/directories to open first.
5. \`## Repo mental model\` - main systems, entry points, and data flow grounded in evidence.
6. \`## Local workflow\` - install, run, build, test, and verification commands when visible.
7. \`## Folder guide\` - one short bullet per top-level folder: purpose, key files, and what kind of changes belong there.
8. \`## Coding rules\` - conventions and safety rules grounded in the files.${coverageSections}`;

  const content = await llm.complete({ system: AGENT_SYSTEM_PROMPT, user, maxTokens: 7000 });
  return { filename: "AGENTS.md", content, signals: paths };
}

/** @deprecated Use generateAgentsDoc */
export const generateAgentDoc = generateAgentsDoc;

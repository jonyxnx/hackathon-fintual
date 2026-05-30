import path from "node:path";
import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import { SYSTEM_PROMPT, buildFileBlocks, type GeneratorResult } from "./index";

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

const SOURCE_EXTS = new Set([
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
  ".md",
  ".mdx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
]);

const testLike = /(^|\/)(__tests__|test|tests|spec|fixtures|mocks)(\/|$)|\.(test|spec)\./;
const entryLike = /(^|\/)(README(\.[\w]+)?|package\.json|index\.[\w]+|main\.[\w]+|app\.[\w]+|route\.[\w]+|layout\.[\w]+)$/i;

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

function folderFiles(ctx: RepoContext, folder: string): string[] {
  const normalized = normalizeFolder(folder);
  return ctx.fileTree
    .filter((file) => file === normalized || file.startsWith(`${normalized}/`))
    .sort();
}

function pickImportantFiles(files: string[], limit = 24): string[] {
  return [...files]
    .filter((file) => SOURCE_EXTS.has(path.extname(file)) || entryLike.test(file))
    .filter((file) => !testLike.test(file))
    .sort((a, b) => {
      const aEntry = entryLike.test(a) ? 0 : 1;
      const bEntry = entryLike.test(b) ? 0 : 1;
      if (aEntry !== bEntry) return aEntry - bEntry;
      const aDepth = a.split("/").length;
      const bDepth = b.split("/").length;
      if (aDepth !== bDepth) return aDepth - bDepth;
      return a.length - b.length || a.localeCompare(b);
    })
    .slice(0, limit);
}

function fileTreeList(files: string[], maxEntries = 400): string {
  const list = files.slice(0, maxEntries);
  const more = files.length - list.length;
  return list.map((file) => `- \`${file}\``).join("\n") + (more > 0 ? `\n- ... (${more} more files)` : "");
}

export interface DocManifestEntry {
  /** Repo-relative path of the documented file or folder. */
  path: string;
  kind: "folder" | "file";
}

export interface DocManifest {
  documented: DocManifestEntry[];
  /** Files intentionally not given a dedicated doc page (assets, lockfiles, etc.). */
  skipped: string[];
}

function manifestSection(manifest: DocManifest, totalFiles: number): string {
  const folders = manifest.documented.filter((e) => e.kind === "folder").map((e) => e.path);
  const files = manifest.documented.filter((e) => e.kind === "file").map((e) => e.path);
  const lines = [
    `Documentation pages already generated in Notion for this run:`,
    ``,
    `- Folder pages (${folders.length}):`,
    ...folders.slice(0, 200).map((f) => `  - \`${f}\``),
    folders.length > 200 ? `  - ... (${folders.length - 200} more)` : "",
    ``,
    `- File pages (${files.length} of ${totalFiles} files):`,
    ...files.slice(0, 300).map((f) => `  - \`${f}\``),
    files.length > 300 ? `  - ... (${files.length - 300} more)` : "",
    ``,
    `- Files skipped (no dedicated page; ${manifest.skipped.length}):`,
    ...manifest.skipped.slice(0, 100).map((f) => `  - \`${f}\``),
    manifest.skipped.length > 100 ? `  - ... (${manifest.skipped.length - 100} more)` : "",
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
    ? `\n\nDocumentation coverage for this run:\n\n${manifestSection(manifest, ctx.fileTree.length)}`
    : "";

  const coverageSections = manifest
    ? `
9. \`## Documentation index\` - explain how the Notion documentation tree is organized (repo page → folder pages → nested folder/file pages, each folder has its own AGENTS.md) and how a developer should navigate it.
10. \`## Documentation coverage\` - based on the coverage data above, summarize what is documented (folders and files) and call out which areas are thin or missing dedicated pages.
11. \`## Gaps and recommended additions\` - list specific files, folders, or topics that still need documentation or deeper coverage, and what each new doc should contain. This is the "what's missing, add it" section.
12. \`## CI and automation\` - GitHub Actions / Notion sync / deploy hooks when visible.
13. \`## Change safety checklist\` - checks before handing off changes.
14. \`## Unknowns to verify\` - facts not visible from provided files.`
    : `
9. \`## CI and automation\` - GitHub Actions / Notion sync / deploy hooks when visible.
10. \`## Change safety checklist\` - checks before handing off changes.
11. \`## Unknowns to verify\` - facts not visible from provided files.`;

  const user = `Write a root **AGENTS.md** file for \`${ctx.owner}/${ctx.repo}\`.

This document lives on the Notion repo page. It is BOTH the primary operating guide for coding agents/new developers AND the index for the documentation tree generated alongside it. It must help someone work fast without reading the entire repository, and it must describe what documentation already exists and what is still missing.

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

  const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 7000 });
  return { filename: "AGENTS.md", content, signals: paths };
}

/** @deprecated Use generateAgentsDoc */
export const generateAgentDoc = generateAgentsDoc;

export async function generateFolderAgentsDoc(
  folder: string,
  ctx: RepoContext,
  llm: LLMProvider,
): Promise<GeneratorResult> {
  const normalizedFolder = normalizeFolder(folder);
  const files = folderFiles(ctx, normalizedFolder);

  if (files.length === 0) {
    return {
      filename: "AGENTS.md",
      content: `# AGENTS.md (${normalizedFolder})\n\n_No files found under \`${normalizedFolder}/\`._\n`,
      signals: [],
    };
  }

  const importantFiles = pickImportantFiles(files);
  const fileBlocks = await buildFileBlocks(ctx, importantFiles, 10 * 1024);

  const user = `Write **AGENTS.md** for the \`${normalizedFolder}/\` folder in \`${ctx.owner}/${ctx.repo}\`.

This page is nested under the \`${normalizedFolder}\` Notion folder doc. It must help a coding agent work inside this folder fast: what each file does, what to change, and how to find data quickly.

All files in this folder (${files.length} total):
${fileTreeList(files)}

Key file contents:

${fileBlocks || "(no readable source samples)"}

Produce:
1. \`# AGENTS.md\` heading (scope: \`${normalizedFolder}/\`).
2. \`## Quick start\` - how to understand this folder in under 2 minutes (read order + why).
3. \`## File index\` - markdown table: File | Summary | Change triggers | Fast lookup. Include every file listed above; infer role from path/name when content was not provided, and be explicit when inferring.
4. \`## Change map\` - typical edits in this folder mapped to starting files and related files to check.
5. \`## Dependencies\` - imports, APIs, configs, or sibling folders this area depends on (only when supported by evidence).
6. \`## Fast data lookup\` - concrete tips: which symbols to search, which configs matter, which tests to run after edits here.
7. \`## Agent notes\` - cautions, edge cases, and unknowns to verify before editing files in this folder.`;

  const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 5500 });
  return { filename: "AGENTS.md", content, signals: importantFiles };
}

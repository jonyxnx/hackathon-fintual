import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import { DOC_PACK_SECTIONS } from "../catalog";
import { overview } from "./overview";
import { setup } from "./setup";
import { testing } from "./testing";
import { deployment } from "./deployment";
import { conventions } from "./conventions";
import { migrations } from "./migrations";

export interface GeneratorResult {
  filename: string;
  content: string;
  signals: string[];
}

export interface Generator {
  id: string;
  title: string;
  filename: string;
  run(ctx: RepoContext, llm: LLMProvider): Promise<GeneratorResult>;
}

export const ALL_GENERATORS: Generator[] = [
  overview,
  setup,
  testing,
  deployment,
  conventions,
  migrations,
];

export function getGenerators(ids?: string[]): Generator[] {
  if (!ids || ids.length === 0) return ALL_GENERATORS;
  const set = new Set(ids);
  return ALL_GENERATORS.filter((g) => set.has(g.id));
}

const FALLBACK_CONTEXT_PATTERNS = [
  "**/README.md",
  "**/readme.md",
  "**/package.json",
  "**/pyproject.toml",
  "**/Makefile",
  "**/go.mod",
];

export async function buildBroadContext(
  ctx: RepoContext,
  maxFiles = 6,
): Promise<{ blocks: string; paths: string[] }> {
  const paths = await ctx.findFiles(FALLBACK_CONTEXT_PATTERNS, maxFiles);
  const blocks = await buildFileBlocks(ctx, paths, 12 * 1024);
  return { blocks, paths };
}

export async function buildFileBlocks(
  ctx: RepoContext,
  paths: string[],
  perFileMax = 16 * 1024,
): Promise<string> {
  const blocks: string[] = [];
  for (const p of paths) {
    if (!(await ctx.exists(p))) continue;
    const content = await ctx.readFile(p, perFileMax);
    blocks.push(`<file path="${p}">\n${content}\n</file>`);
  }
  return blocks.join("\n\n");
}

export const SYSTEM_PROMPT = `You are a precise technical writer creating internal engineering documentation for a real codebase. Your reader is a human developer joining the team.
Rules:
- Write ONLY what is supported by the provided files. If something is unknown or absent, say so explicitly.
- Do not invent versions, commands, URLs, or behavior.
- Optimize for a new company developer (a human engineer) who needs to understand and safely change this repo, not for public product marketing or end-user usage.
- Write for people: clear, practical, and skimmable. Do NOT address AI agents or include "agent" instructions/checklists — that guidance lives in a separate AGENTS.md file.
- Explain how the repo is put together, where to make changes, what conventions to follow, and what to be careful about.
- Output GitHub-flavored markdown. No preamble. Start with the requested heading.
- Keep a consistent style: short paragraphs, flat bullet lists, and predictable section headings.
- Prefer bullets for steps, commands, conventions, and file lists. Use prose only for brief summaries.
- Go deep enough that a new developer can make a safe first change without reading the whole repo first.
- Include relationships between files and systems when the evidence supports them.
- Prefer actionable guidance over generic explanation.
- Do not add source-footers such as "Generated from" or explain where the information came from.
- When you reference a file, use backticks and its repo-relative path.
- Each doc is one section of full project documentation (${DOC_PACK_SECTIONS.join(", ")}). Cover the full requested scope for that section even when evidence is sparse.`;

export function notDetectedStub(title: string, _looked: string[]): string {
  return [
    `# ${title}`,
    "",
    "_No clear evidence for this area was detected in the repository._",
    "",
    "Treat this topic as unknown until the repo gains explicit configuration or source files for it.",
    "",
  ].join("\n");
}

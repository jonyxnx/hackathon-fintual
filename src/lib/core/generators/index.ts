import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import {
  DEFAULT_TOTAL_PROMPT_CHARS,
  capFilePaths,
  compressFileContent,
  compressionNote,
  resolveFileBudgets,
} from "../promptCompress";

export interface GeneratorResult {
  filename: string;
  content: string;
  signals: string[];
}

/**
 * How deep a doc should go, on a 1-10 scale.
 * - 10: scan the whole repo in detail (effectively line by line).
 * - 5: cover only the important things (the default).
 * - 1: just enough to get a rough idea of what the repo does.
 */
export interface DepthConfig {
  level: number;
  /** Multiplier applied to a generator's base maxTokens. */
  tokenScale: number;
  /** Multiplier applied to how much file context (count/bytes) to read. */
  contextScale: number;
  /** Instruction injected into prompts describing how deep to go. */
  guidance: string;
}

export const DEFAULT_DEPTH = 5;

export function resolveDepth(level: number): DepthConfig {
  const clamped = Math.min(10, Math.max(1, Math.round(level)));
  // Level 5 is the baseline (matches the previous, un-scaled behavior).
  const tokenScale = clamped <= 5 ? 0.3 + (clamped - 1) * (0.7 / 4) : 1 + (clamped - 5) * (1.5 / 5);
  const contextScale = clamped <= 5 ? 0.4 + (clamped - 1) * (0.6 / 4) : 1 + (clamped - 5) * (1.0 / 5);

  let guidance: string;
  if (clamped >= 8) {
    guidance = `Depth ${clamped}/10: be thorough. Walk the important files in detail (at depth 10, effectively line by line) and explain how things actually work. Stay readable, but favor completeness over brevity.`;
  } else if (clamped >= 4) {
    guidance = `Depth ${clamped}/10: cover only the important things and keep it concise.`;
  } else {
    guidance = `Depth ${clamped}/10: stay very high level — just enough to give a rough idea of what this is. A few short bullets; skip the details.`;
  }

  return { level: clamped, tokenScale, contextScale, guidance };
}

/** Scale a generator's base token budget by the active depth. */
export function scaledTokens(base: number, depth?: DepthConfig): number {
  if (!depth) return base;
  return Math.max(256, Math.round(base * depth.tokenScale));
}

/** Scale a count/byte budget by the active depth (with a sensible floor). */
export function scaledContext(base: number, depth: DepthConfig | undefined, min: number): number {
  if (!depth) return base;
  return Math.max(min, Math.round(base * depth.contextScale));
}

/** Depth guidance line for prompts, or empty string when depth is unset. */
export function depthGuidance(depth?: DepthConfig): string {
  return depth ? `\n${depth.guidance}\n` : "";
}

export interface Generator {
  id: string;
  title: string;
  filename: string;
  run(ctx: RepoContext, llm: LLMProvider, depth?: DepthConfig): Promise<GeneratorResult>;
}

const FALLBACK_CONTEXT_PATTERNS = [
  "**/README.md",
  "**/readme.md",
  "**/package.json",
  "**/pyproject.toml",
  "**/Makefile",
  "**/go.mod",
];

export interface BuildFileBlocksOptions {
  perFileMax?: number;
  /** Max combined size of all file blocks (chars). Defaults to ~96KB. */
  totalMax?: number;
  /** Hard cap on how many files to include after compression budgeting. */
  maxFiles?: number;
}

export async function buildBroadContext(
  ctx: RepoContext,
  maxFiles = 6,
  depth?: DepthConfig,
): Promise<{ blocks: string; paths: string[] }> {
  const paths = await ctx.findFiles(FALLBACK_CONTEXT_PATTERNS, maxFiles);
  const blocks = await buildFileBlocks(ctx, paths, {
    perFileMax: scaledContext(12 * 1024, depth, 4 * 1024),
    maxFiles: scaledContext(maxFiles, depth, 3),
  });
  return { blocks, paths };
}

export async function buildFileBlocks(
  ctx: RepoContext,
  paths: string[],
  perFileMaxOrOpts: number | BuildFileBlocksOptions = 16 * 1024,
): Promise<string> {
  const opts: BuildFileBlocksOptions =
    typeof perFileMaxOrOpts === "number" ? { perFileMax: perFileMaxOrOpts } : perFileMaxOrOpts;
  const perFileMax = opts.perFileMax ?? 16 * 1024;
  const totalMax = opts.totalMax ?? DEFAULT_TOTAL_PROMPT_CHARS;
  const maxFiles = opts.maxFiles ?? 32;

  const originalCount = paths.length;
  const cappedPaths = capFilePaths(paths, maxFiles);
  const budgets = resolveFileBudgets(cappedPaths.length, { perFileMax, totalMax });

  const blocks: string[] = [];
  for (let i = 0; i < cappedPaths.length; i++) {
    const p = cappedPaths[i];
    if (!(await ctx.exists(p))) continue;
    const raw = await ctx.readFile(p, budgets[i] * 2);
    const content = compressFileContent(raw, p, budgets[i]);
    blocks.push(`<file path="${p}">\n${content}\n</file>`);
  }

  const note = compressionNote(cappedPaths.length, originalCount);
  return note + blocks.join("\n\n");
}

export const SYSTEM_PROMPT = `You are a technical writer creating SHORT, high-signal internal docs for a real codebase. Your reader is a human developer joining the team.
Rules:
- Keep it short. Each page should be skimmable in under a minute. Prefer a few strong bullets over long prose.
- Document only what matters: the important files, decisions, and gotchas. Skip the obvious, the trivial, and anything a developer can read from the code in seconds. Do NOT try to document everything.
- Use plain, simple language. Short sentences. No jargon, no filler, no marketing.
- Write ONLY what is supported by the provided files. Do not invent commands, versions, URLs, or behavior. If something important is missing, say so in one line; otherwise just omit it.
- Write for people, not AI agents. Do not include "agent" instructions or checklists — that lives in a separate AGENTS.md file.
- Output GitHub-flavored markdown. No preamble. Start with the requested heading. Omit any section that has nothing important to say.
- Prefer short bullets and small tables. Reference files with backticks and repo-relative paths.
- Do not add source-footers or explain where the information came from.`;

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

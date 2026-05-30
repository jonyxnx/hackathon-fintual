import path from "node:path";

/** Rough upper bound for all `<file>` blocks combined in one LLM prompt. */
export const DEFAULT_TOTAL_PROMPT_CHARS = 96 * 1024;

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

function isLockfile(filePath: string): boolean {
  const name = path.basename(filePath);
  return LOCKFILE_NAMES.has(name);
}

const MINIFIED_EXT = [".min.js", ".min.css", ".map"];

function isMinifiedArtifact(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return MINIFIED_EXT.some((ext) => lower.endsWith(ext));
}

/** Collapse runs of blank lines and trim trailing spaces. */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Keep the start and end of a long file so exports and setup both remain visible. */
function headTailTruncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const marker = "\n\n[... middle omitted for prompt size ...]\n\n";
  const markerLen = marker.length;
  const budget = maxChars - markerLen;
  if (budget < 400) return text.slice(0, maxChars) + "\n\n[... truncated ...]";

  const headChars = Math.floor(budget * 0.62);
  const tailChars = budget - headChars;
  return text.slice(0, headChars) + marker + text.slice(-tailChars);
}

function compressLockfile(text: string, maxChars: number): string {
  const lines = text.split(/\r?\n/);
  const preview = lines.slice(0, 48).join("\n");
  const note = `\n\n[... lockfile compressed: ${lines.length} lines total, showing first 48 ...]`;
  const combined = preview + note;
  return combined.length <= maxChars ? combined : combined.slice(0, maxChars);
}

function compressMinified(text: string, maxChars: number): string {
  const note = `[minified/bundled file compressed: ${text.length} chars, showing start only]\n\n`;
  const budget = maxChars - note.length;
  return note + text.slice(0, Math.max(0, budget));
}

/**
 * Shrink a single file's text for LLM context while keeping the most useful parts.
 */
export function compressFileContent(content: string, filePath: string, maxChars: number): string {
  if (maxChars < 256) maxChars = 256;

  let text = normalizeWhitespace(content);
  if (!text) return text;

  if (isMinifiedArtifact(filePath)) return compressMinified(text, maxChars);
  if (isLockfile(filePath)) return compressLockfile(text, maxChars);

  // Very long single-line files (generated JSON, etc.)
  if (text.length > maxChars && !text.includes("\n")) {
    return text.slice(0, maxChars - 40) + "\n\n[... long single line truncated ...]";
  }

  return headTailTruncate(text, maxChars);
}

export interface BuildFileBlocksBudget {
  perFileMax: number;
  totalMax?: number;
}

/** When there are many files, shrink per-file limits so the combined prompt stays bounded. */
export function resolveFileBudgets(fileCount: number, opts: BuildFileBlocksBudget): number[] {
  if (fileCount === 0) return [];

  const totalMax = opts.totalMax ?? DEFAULT_TOTAL_PROMPT_CHARS;
  const evenShare = Math.floor(totalMax / fileCount);
  let perFile = Math.min(opts.perFileMax, evenShare);

  // Many files: compress harder so we don't send 30 full slices.
  if (fileCount > 12) perFile = Math.min(perFile, Math.floor(totalMax / (fileCount * 1.15)));
  if (fileCount > 24) perFile = Math.min(perFile, 3 * 1024);

  return Array.from({ length: fileCount }, () => Math.max(512, perFile));
}

/** Trim the file list if even compressed blocks would exceed the total budget. */
export function capFilePaths(paths: string[], maxFiles: number): string[] {
  if (paths.length <= maxFiles) return paths;
  return paths.slice(0, maxFiles);
}

export function compressionNote(fileCount: number, originalCount: number): string {
  if (fileCount >= originalCount) return "";
  return `_Prompt compression: showing ${fileCount} of ${originalCount} candidate files._\n\n`;
}

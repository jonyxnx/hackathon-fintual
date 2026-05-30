import path from "node:path";
import type { RepoContext } from "../context";
import type { LLMProvider } from "../llm";
import { SYSTEM_PROMPT, type GeneratorResult } from "./index";

/** Extensions and filenames we never write a dedicated doc page for. */
const SKIP_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".bmp",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".zip",
  ".gz",
  ".tar",
  ".jar",
  ".wasm",
  ".map",
  ".lock",
]);

const SKIP_NAME_PATTERNS = [
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /\.min\.(js|css)$/i,
  /^\.ds_store$/i,
  /\.tsbuildinfo$/i,
];

export function isDocumentableFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? filePath;
  if (SKIP_NAME_PATTERNS.some((p) => p.test(name))) return false;
  const ext = path.extname(name).toLowerCase();
  if (SKIP_EXTS.has(ext)) return false;
  return true;
}

/**
 * Document a single file: what it is, key symbols, how it works, what to change,
 * how to find data fast, and gotchas. This is the leaf of the doc tree.
 */
export async function generateFileDoc(
  filePath: string,
  ctx: RepoContext,
  llm: LLMProvider,
): Promise<GeneratorResult> {
  const exists = await ctx.exists(filePath);
  const content = exists ? await ctx.readFile(filePath, 24 * 1024) : "";
  const ext = path.extname(filePath);

  const user = `Write developer documentation for the single file \`${filePath}\` in \`${ctx.owner}/${ctx.repo}\`.

This page is the leaf of a documentation tree built for coding agents and new developers. It should let someone understand and safely change this file without reading the rest of the repo.

File type: ${ext || "(no extension)"}

File contents${exists ? "" : " (could not be read; infer cautiously from the path)"}:
\`\`\`${ext.replace(".", "")}
${content || "(empty or unreadable)"}
\`\`\`

Produce:
1. \`# ${filePath.split("/").pop()}\` heading.
2. \`## Summary\` - one short paragraph: what this file is and why it exists.
3. \`## Key contents\` - the important exports, functions, classes, components, types, or config keys, each with a one-line description of what it does.
4. \`## How it works\` - the notable logic, control flow, or configuration behavior visible in the file.
5. \`## What to change here\` - concrete edits a developer would make in this file and the impact of each.
6. \`## Fast lookup\` - the exact symbols/strings to search for to find specific behavior quickly, and what each points to.
7. \`## Dependencies & relationships\` - what this file imports, what imports it (when inferable), and external libraries it relies on.
8. \`## Gotchas\` - edge cases, side effects, and things to verify before editing. State unknowns explicitly.

Keep it tight and specific to THIS file. Do not invent behavior that is not supported by the contents.`;

  const docContent = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 3500 });
  return { filename: `${filePath}.md`, content: docContent, signals: [filePath] };
}

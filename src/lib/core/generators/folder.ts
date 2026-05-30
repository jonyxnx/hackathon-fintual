import path from "node:path";
import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildFileBlocks, depthGuidance, notDetectedStub, scaledContext, scaledTokens } from "./index";

const SAMPLE_LIMIT = 30;
const FILE_TREE_LIMIT = 400;

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
]);

const testLike = /(^|\/)(__tests__|test|tests|spec|fixtures|mocks)(\/|$)|\.(test|spec)\./;
const entryLike = /(^|\/)(README(\.[\w]+)?|package\.json|index\.[\w]+|main\.[\w]+|app\.[\w]+|route\.[\w]+|layout\.[\w]+)$/i;
const configLike = /(^|\/)(tsconfig|next\.config|vite\.config|webpack\.config|tailwind\.config|postcss\.config|eslint\.config|\.eslintrc|\.prettierrc)/i;

function normalizeFolder(folder: string): string {
  return folder.replace(/^\/+|\/+$/g, "");
}

function folderFileTree(files: string[], maxEntries = FILE_TREE_LIMIT): string {
  const list = files.slice(0, maxEntries);
  const more = files.length - list.length;
  return list.join("\n") + (more > 0 ? `\n... (${more} more files)` : "");
}

function pickRepresentativeFiles(files: string[]): string[] {
  const sourceFiles = files.filter((file) => SOURCE_EXTS.has(path.extname(file))).filter((file) => !testLike.test(file));

  return [...sourceFiles]
    .sort((a, b) => {
      const aEntry = entryLike.test(a) ? 0 : 1;
      const bEntry = entryLike.test(b) ? 0 : 1;
      if (aEntry !== bEntry) return aEntry - bEntry;

      const aConfig = configLike.test(a) ? 0 : 1;
      const bConfig = configLike.test(b) ? 0 : 1;
      if (aConfig !== bConfig) return aConfig - bConfig;

      const aDepth = a.split("/").length;
      const bDepth = b.split("/").length;
      if (aDepth !== bDepth) return aDepth - bDepth;

      return a.length - b.length || a.localeCompare(b);
    })
    .slice(0, SAMPLE_LIMIT);
}

function directSubdirs(files: string[], folder: string): string[] {
  const prefix = folder ? `${folder}/` : "";
  const set = new Set<string>();
  for (const file of files) {
    const rest = file.slice(prefix.length);
    const idx = rest.indexOf("/");
    if (idx > 0) set.add(rest.slice(0, idx));
  }
  return [...set].sort();
}

export interface FolderGeneratorOptions {
  /** When true, produce a deeper doc that breaks the folder down by concern. */
  deep?: boolean;
}

export function folderGenerator(folder: string, opts: FolderGeneratorOptions = {}): Generator {
  const normalizedFolder = normalizeFolder(folder);
  const deep = opts.deep ?? false;

  return {
    id: `folder:${normalizedFolder}`,
    title: normalizedFolder,
    filename: `${normalizedFolder}.md`,
    async run(ctx, llm, depth) {
      const files = ctx.fileTree.filter((file) => file === normalizedFolder || file.startsWith(`${normalizedFolder}/`)).sort();

      if (files.length === 0) {
        return {
          filename: `${normalizedFolder}.md`,
          content: notDetectedStub(normalizedFolder, [`${normalizedFolder}/**/*`]),
          signals: [],
        };
      }

      const baseSample = deep ? SAMPLE_LIMIT + 12 : SAMPLE_LIMIT;
      const sampleLimit = scaledContext(baseSample, depth, 6);
      const sampleFiles = pickRepresentativeFiles(files).slice(0, sampleLimit);
      const fileBlocks = await buildFileBlocks(ctx, sampleFiles, {
        perFileMax: scaledContext(14 * 1024, depth, 4 * 1024),
        maxFiles: sampleLimit,
      });
      const subdirs = directSubdirs(files, normalizedFolder);

      const deepSection = deep
        ? `

This folder is larger than most, so add one extra section:
- \`## Main parts\` - group the files by concern in a few short bullets (don't catalog every file). If a part is big enough to deserve its own doc, note it in one line.`
        : "";

      const user = `Write a SHORT doc for the \`${normalizedFolder}\` folder in \`${ctx.owner}/${ctx.repo}\` — enough to know what's here and where to make changes, without reading every file.

This folder has ${files.length} files across ${subdirs.length} immediate subfolders.

Immediate subfolders: ${subdirs.length ? subdirs.join(", ") : "(none)"}

Folder file tree (truncated):
\`\`\`
${folderFileTree(files)}
\`\`\`

Representative file contents:

${fileBlocks || "(no representative source files found)"}

Produce a short doc (omit any section with nothing important):
1. \`# ${normalizedFolder}\` heading.
2. \`## Purpose\` - what this folder owns, in 1-2 sentences.
3. \`## Key files\` - only the few most important files/subfolders, one short line each. Skip minor ones.
4. \`## How to work here\` - where to start for common changes, plus any real gotcha.${deepSection}

Keep it short and plain. Don't document every file — only the important ones.
${depthGuidance(depth)}`;

      const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(deep ? 2800 : 1600, depth) });
      return { filename: `${normalizedFolder}.md`, content, signals: sampleFiles };
    },
  };
}

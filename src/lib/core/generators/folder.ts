import path from "node:path";
import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildFileBlocks, notDetectedStub } from "./index";

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
    async run(ctx, llm) {
      const files = ctx.fileTree.filter((file) => file === normalizedFolder || file.startsWith(`${normalizedFolder}/`)).sort();

      if (files.length === 0) {
        return {
          filename: `${normalizedFolder}.md`,
          content: notDetectedStub(normalizedFolder, [`${normalizedFolder}/**/*`]),
          signals: [],
        };
      }

      const sampleLimit = deep ? SAMPLE_LIMIT + 12 : SAMPLE_LIMIT;
      const sampleFiles = pickRepresentativeFiles(files).slice(0, sampleLimit);
      const fileBlocks = await buildFileBlocks(ctx, sampleFiles, 14 * 1024);
      const subdirs = directSubdirs(files, normalizedFolder);

      const deepSection = deep
        ? `

This is a large, multi-concern folder. In addition to the sections above:
- \`## Concerns breakdown\` - identify the distinct responsibilities/concerns living in this folder and which files belong to each. If a concern is large enough to deserve its own document, call it out.
- Go deeper on each major file or module rather than summarizing at a high level.`
        : "";

      const user = `Write ${deep ? "deep, thorough" : "focused"} internal documentation for the \`${normalizedFolder}\` folder in \`${ctx.owner}/${ctx.repo}\`.

This folder contains ${files.length} files across ${subdirs.length} immediate subfolders. Be specific: a developer should be able to work here without opening every file. Smaller subfolders that do not have their own page are documented here as part of this folder.

Immediate subfolders: ${subdirs.length ? subdirs.join(", ") : "(none)"}

Folder file tree (truncated):
\`\`\`
${folderFileTree(files)}
\`\`\`

Representative file contents:

${fileBlocks || "(no representative source files found)"}

Produce internal folder documentation:
1. \`# ${normalizedFolder}\` heading.
2. \`## Purpose\` - what this folder owns and why it exists.
3. \`## Structure\` - each immediate subfolder and the most important files, with a one-line role for each.
4. \`## Key modules and responsibilities\` - explain the main files/classes/functions visible from the samples, including notable exports and what calls them.
5. \`## Data flow\` - how data/control moves through this folder when the evidence supports it.
6. \`## Connections\` - imports from and exports to the rest of the repo, plus external libraries used here.
7. \`## Change map\` - common tasks (add/modify/remove behavior) mapped to the exact files to open first.
8. \`## Fast lookup\` - which symbols to search and which files to read first for the most common questions about this folder.
9. \`## Gotchas\` - practical cautions, edge cases, and unknowns a developer should check before editing here.${deepSection}`;

      const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: deep ? 6500 : 4500 });
      return { filename: `${normalizedFolder}.md`, content, signals: sampleFiles };
    },
  };
}

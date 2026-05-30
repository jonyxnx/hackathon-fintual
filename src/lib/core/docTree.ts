import type { RepoContext } from "./context";
import { mapWithConcurrency } from "./concurrency";
import { generateAgentsDoc, type DocManifest } from "./generators/agent";
import { folderGenerator } from "./generators/folder";
import { isDocumentableFile } from "./generators/file";
import { setup } from "./generators/setup";
import { deployment } from "./generators/deployment";
import { conventions } from "./generators/conventions";
import { improvements } from "./generators/improvements";
import type { DepthConfig, Generator, GeneratorResult } from "./generators";
import { AGENTS_ICON, iconForPath } from "./icons";
import type { LLMProvider } from "./llm";

export const DEFAULT_MIN_FOLDER_FILES = 3;
export const WEB_MIN_FOLDER_FILES = 4;
export const AGENTS_PAGE_TITLE = "AGENTS.md";

/** Max concurrent folder (and root) doc LLM calls. */
const DOC_CONCURRENCY = Math.max(1, Number(process.env.KITDOC_DOC_CONCURRENCY ?? 4) || 4);

class LlmSlotPool {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const llmSlots = new LlmSlotPool(DOC_CONCURRENCY);

/** A folder this large (or with this many subfolders) gets a deeper, concern-split doc. */
const BIG_FOLDER_FILES = 12;
const BIG_FOLDER_SUBDIRS = 4;

export const ROOT_DOCS: Array<{ gen: Generator; title: string; filename: string; icon: string }> = [
  { gen: setup, title: "Local setup", filename: "setup.md", icon: "🧰" },
  { gen: deployment, title: "Deployment", filename: "deployment.md", icon: "🚀" },
  { gen: conventions, title: "Codebase patterns", filename: "conventions.md", icon: "📐" },
  { gen: improvements, title: "Improvements", filename: "improvements.md", icon: "✨" },
];

export interface DocSink {
  ensure(parentId: string, title: string, icon: string, label: string): Promise<string>;
  write(pageId: string, markdown: string, icon: string, label: string): Promise<void>;
}

export interface DocTreeEvent {
  type: "doc:started" | "doc:done" | "doc:failed";
  id: string;
  title: string;
  filename: string;
  icon: string;
  parentId: string;
  kind: "root" | "folder" | "agent";
  content?: string;
  result?: GeneratorResult;
  error?: string;
}

export interface DocumentRepoOptions {
  ctx: RepoContext;
  llm: LLMProvider;
  sink: DocSink;
  depth: DepthConfig;
  parentPageId: string;
  fullRun: boolean;
  minFolderFiles?: number;
  changedRoots?: string[] | null;
  onEvent?: (event: DocTreeEvent) => void;
}

interface DirNode {
  path: string;
  name: string;
  dirs: Map<string, DirNode>;
  files: string[];
}

export function buildTree(files: string[], roots?: string[]): DirNode {
  const root: DirNode = { path: "", name: "", dirs: new Map(), files: [] };
  for (const file of files) {
    if (roots && !roots.some((r) => file === r || file.startsWith(`${r}/`))) continue;
    const parts = file.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      const childPath = node.path ? `${node.path}/${seg}` : seg;
      let child = node.dirs.get(seg);
      if (!child) {
        child = { path: childPath, name: seg, dirs: new Map(), files: [] };
        node.dirs.set(seg, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

function countDocumentableFiles(node: DirNode): number {
  let total = node.files.filter(isDocumentableFile).length;
  for (const child of node.dirs.values()) total += countDocumentableFiles(child);
  return total;
}

function isSignificant(node: DirNode, minFiles: number): boolean {
  return countDocumentableFiles(node) >= minFiles;
}

function isBig(node: DirNode): boolean {
  return countDocumentableFiles(node) >= BIG_FOLDER_FILES || node.dirs.size >= BIG_FOLDER_SUBDIRS;
}

function folderFilename(path: string): string {
  return `${path}.md`;
}

async function documentDirNode(
  child: DirNode,
  parentPageId: string,
  manifest: DocManifest,
  opts: Required<Pick<DocumentRepoOptions, "ctx" | "llm" | "sink" | "depth" | "minFolderFiles">> &
    Pick<DocumentRepoOptions, "onEvent">,
): Promise<void> {
  if (!isSignificant(child, opts.minFolderFiles)) {
    manifest.skipped.push(child.path);
    await documentChildren(child, parentPageId, manifest, opts);
    return;
  }

  const deep = isBig(child);
  const icon = iconForPath(child.path);
  const filename = folderFilename(child.path);
  opts.onEvent?.({
    type: "doc:started",
    id: child.path,
    title: child.name,
    filename,
    icon,
    parentId: parentPageId,
    kind: "folder",
  });
  const folderPageId = await opts.sink.ensure(parentPageId, child.name, icon, child.path);
  manifest.documented.push({ path: child.path, kind: "folder", icon });

  await documentChildren(child, folderPageId, manifest, opts);

  try {
    const folderDoc = await llmSlots.use(() => folderGenerator(child.path, { deep }).run(opts.ctx, opts.llm, opts.depth));
    const result = { ...folderDoc, filename };
    await opts.sink.write(folderPageId, folderDoc.content, icon, child.path);
    opts.onEvent?.({
      type: "doc:done",
      id: child.path,
      title: child.name,
      filename,
      icon,
      parentId: parentPageId,
      kind: "folder",
      content: folderDoc.content,
      result,
    });
  } catch (err) {
    opts.onEvent?.({
      type: "doc:failed",
      id: child.path,
      title: child.name,
      filename,
      icon,
      parentId: parentPageId,
      kind: "folder",
      error: (err as Error).message ?? String(err),
    });
  }
}

async function documentChildren(
  node: DirNode,
  parentPageId: string,
  manifest: DocManifest,
  opts: Required<Pick<DocumentRepoOptions, "ctx" | "llm" | "sink" | "depth" | "minFolderFiles">> &
    Pick<DocumentRepoOptions, "onEvent">,
): Promise<void> {
  const children = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  await mapWithConcurrency(children, DOC_CONCURRENCY, (child) =>
    documentDirNode(child, parentPageId, manifest, opts),
  );
}

export async function documentRepo(opts: DocumentRepoOptions): Promise<DocManifest> {
  const minFolderFiles = opts.minFolderFiles ?? DEFAULT_MIN_FOLDER_FILES;
  const manifest: DocManifest = {
    documented: [],
    skipped: [],
    rootDocs: [],
    fullRun: opts.fullRun,
  };
  const childOpts = {
    ctx: opts.ctx,
    llm: opts.llm,
    sink: opts.sink,
    depth: opts.depth,
    minFolderFiles,
    onEvent: opts.onEvent,
  };

  for (const { gen, title, filename, icon } of ROOT_DOCS) {
    opts.onEvent?.({ type: "doc:started", id: filename, title, filename, icon, parentId: opts.parentPageId, kind: "root" });
  }

  const completedRoots = new Set<string>();
  await mapWithConcurrency(ROOT_DOCS, DOC_CONCURRENCY, async ({ gen, title, filename, icon }) => {
    try {
      const doc = await llmSlots.use(() => gen.run(opts.ctx, opts.llm, opts.depth));
      const pageId = await opts.sink.ensure(opts.parentPageId, title, icon, title);
      await opts.sink.write(pageId, doc.content, icon, title);
      completedRoots.add(filename);
      opts.onEvent?.({
        type: "doc:done",
        id: filename,
        title,
        filename,
        icon,
        parentId: opts.parentPageId,
        kind: "root",
        content: doc.content,
        result: { ...doc, filename },
      });
    } catch (err) {
      opts.onEvent?.({
        type: "doc:failed",
        id: filename,
        title,
        filename,
        icon,
        parentId: opts.parentPageId,
        kind: "root",
        error: (err as Error).message ?? String(err),
      });
    }
  });
  manifest.rootDocs = ROOT_DOCS.filter(({ filename }) => completedRoots.has(filename)).map(({ title, icon }) => ({
    title,
    icon,
  }));

  const agentsPageId = await opts.sink.ensure(opts.parentPageId, AGENTS_PAGE_TITLE, AGENTS_ICON, AGENTS_PAGE_TITLE);
  const tree = buildTree(opts.ctx.fileTree, opts.changedRoots ?? undefined);
  await documentChildren(tree, opts.parentPageId, manifest, childOpts);

  opts.onEvent?.({
    type: "doc:started",
    id: AGENTS_PAGE_TITLE,
    title: AGENTS_PAGE_TITLE,
    filename: AGENTS_PAGE_TITLE,
    icon: AGENTS_ICON,
    parentId: opts.parentPageId,
    kind: "agent",
  });
  try {
    const agentsDoc = await generateAgentsDoc(opts.ctx, opts.llm, manifest, opts.depth);
    await opts.sink.write(agentsPageId, agentsDoc.content, AGENTS_ICON, AGENTS_PAGE_TITLE);
    opts.onEvent?.({
      type: "doc:done",
      id: AGENTS_PAGE_TITLE,
      title: AGENTS_PAGE_TITLE,
      filename: AGENTS_PAGE_TITLE,
      icon: AGENTS_ICON,
      parentId: opts.parentPageId,
      kind: "agent",
      content: agentsDoc.content,
      result: agentsDoc,
    });
  } catch (err) {
    opts.onEvent?.({
      type: "doc:failed",
      id: AGENTS_PAGE_TITLE,
      title: AGENTS_PAGE_TITLE,
      filename: AGENTS_PAGE_TITLE,
      icon: AGENTS_ICON,
      parentId: opts.parentPageId,
      kind: "agent",
      error: (err as Error).message ?? String(err),
    });
  }

  return manifest;
}

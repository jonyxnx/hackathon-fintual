"use client";

import { useMemo, useState } from "react";

export interface DocNavItem {
  id: string;
  title: string;
  filename: string;
  icon: string;
  kind: "root" | "folder" | "agent";
  status: "running" | "done" | "failed";
  error?: string;
}

interface Props {
  docs: DocNavItem[];
  files: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const MAX_FOLDER_CHILDREN = 20;
const MAX_TREE_NODES = 72;

function folderDepth(id: string): number {
  return id.includes("/") ? id.split("/").length - 1 : 0;
}

export function DocTree({ docs, files, selectedId, onSelect }: Props) {
  const [filesOpen, setFilesOpen] = useState(false);
  const rootDocs = docs.filter((doc) => doc.kind === "root" || doc.kind === "agent");
  const folderDocs = docs.filter((doc) => doc.kind === "folder").sort((a, b) => a.id.localeCompare(b.id));
  const fileNodes = useMemo(() => buildFileTree(files), [files]);
  const nodeBudget = { remaining: MAX_TREE_NODES };

  return (
    <aside className="flex h-full max-h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/80 p-2 shadow-sm">
      <div className="shrink-0 border-b border-stone-100 px-2 pb-2 pt-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Workspace</p>
        <h2 className="text-sm font-semibold text-stone-950">Docs</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <div className="space-y-0.5">
          {[...rootDocs, ...folderDocs].map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onSelect(doc.id)}
              className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs transition-colors ${
                selectedId === doc.id ? "bg-stone-950 text-white" : "text-stone-700 hover:bg-stone-100"
              }`}
              style={{ paddingLeft: doc.kind === "folder" ? 6 + folderDepth(doc.id) * 12 : 6 }}
            >
              <span className="w-4 shrink-0 text-center text-[11px]">
                {doc.status === "running" ? "..." : doc.status === "failed" ? "!" : doc.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{doc.title}</span>
            </button>
          ))}
          {docs.length === 0 && <p className="px-2 py-1 text-xs text-stone-400">Docs will appear here.</p>}
        </div>
      </div>

      <div className="shrink-0 border-t border-stone-100 pt-1">
        <button
          type="button"
          onClick={() => setFilesOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-stone-100"
          aria-expanded={filesOpen}
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">
            Files {files.length ? `(${files.length})` : ""}
          </span>
          <span className="text-[10px] text-stone-400">{filesOpen ? "Hide" : "Show"}</span>
        </button>

        {filesOpen && (
          <div className="mt-1 max-h-[min(11rem,28vh)] min-h-0 overflow-y-auto pb-1">
            {fileNodes.map((node) => (
              <FileNodeView key={node.path} node={node} depth={0} budget={nodeBudget} />
            ))}
            {nodeBudget.remaining <= 0 && files.length > 0 && (
              <p className="px-2 py-1 text-[10px] text-stone-400">Tree truncated for size. Download the zip for the full repo map.</p>
            )}
            {files.length === 0 && <p className="px-2 py-1 text-xs text-stone-400">Repo files will appear here.</p>}
          </div>
        )}
      </div>
    </aside>
  );
}

interface FileNode {
  name: string;
  path: string;
  type: "folder" | "file";
  children: Map<string, FileNode>;
  fileCount: number;
}

function buildFileTree(files: string[]): FileNode[] {
  const root = new Map<string, FileNode>();
  for (const file of files) {
    const parts = file.split("/");
    let children = root;
    let currentPath = "";
    parts.forEach((part, index) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = index === parts.length - 1;
      let node = children.get(part);
      if (!node) {
        node = { name: part, path: currentPath, type: isFile ? "file" : "folder", children: new Map(), fileCount: 0 };
        children.set(part, node);
      }
      node.fileCount += 1;
      children = node.children;
    });
  }
  return sortFileNodes([...root.values()]);
}

function sortFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((node) => ({ ...node, children: new Map(sortFileNodes([...node.children.values()]).map((child) => [child.name, child])) }));
}

function FileNodeView({
  node,
  depth,
  budget,
}: {
  node: FileNode;
  depth: number;
  budget: { remaining: number };
}) {
  const [open, setOpen] = useState(false);
  const children = [...node.children.values()];
  const isFolder = node.type === "folder";

  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;

  if (isFolder) {
    const visibleChildren = children.slice(0, MAX_FOLDER_CHILDREN);
    const hiddenCount = children.length - visibleChildren.length;

    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-stone-600 hover:bg-stone-100"
          style={{ paddingLeft: 6 + depth * 12 }}
          title={node.path}
          aria-expanded={open}
        >
          <span className="w-3 shrink-0 text-[10px] text-stone-400">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
          <span className="shrink-0 text-[10px] text-stone-400">{node.fileCount}</span>
        </button>
        {open &&
          visibleChildren.map((child) => <FileNodeView key={child.path} node={child} depth={depth + 1} budget={budget} />)}
        {open && hiddenCount > 0 && (
          <p className="truncate px-2 py-0.5 font-mono text-[10px] text-stone-400" style={{ paddingLeft: 6 + (depth + 1) * 12 }}>
            ... {hiddenCount} more
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-stone-500"
      style={{ paddingLeft: 6 + depth * 12 }}
      title={node.path}
    >
      <span className="mr-1 text-stone-300">·</span>
      {node.name}
    </div>
  );
}

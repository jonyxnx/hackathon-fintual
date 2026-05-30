"use client";

import type { ReactNode } from "react";
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

function folderDepth(id: string): number {
  return id.includes("/") ? id.split("/").length - 1 : 0;
}

export function DocTree({ docs, files, selectedId, onSelect }: Props) {
  const rootDocs = docs.filter((doc) => doc.kind === "root" || doc.kind === "agent");
  const folderDocs = docs.filter((doc) => doc.kind === "folder").sort((a, b) => a.id.localeCompare(b.id));
  const fileNodes = useMemo(() => buildFileTree(files), [files]);

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-3xl border border-stone-200 bg-white/80 p-3 shadow-sm">
      <div className="border-b border-stone-100 px-2 pb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">Workspace</p>
        <h2 className="mt-1 text-sm font-semibold text-stone-950">Docs and files</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <TreeSection title="Docs">
          {[...rootDocs, ...folderDocs].map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onSelect(doc.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors ${
                selectedId === doc.id ? "bg-stone-950 text-white" : "text-stone-700 hover:bg-stone-100"
              }`}
              style={{ paddingLeft: doc.kind === "folder" ? 8 + folderDepth(doc.id) * 14 : 8 }}
            >
              <span className="w-5 shrink-0 text-center">
                {doc.status === "running" ? "..." : doc.status === "failed" ? "!" : doc.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{doc.title}</span>
            </button>
          ))}
          {docs.length === 0 && <p className="px-2 py-1 text-sm text-stone-400">Docs will appear here.</p>}
        </TreeSection>

        <TreeSection title={`Files ${files.length ? `(${files.length})` : ""}`}>
          {fileNodes.map((node) => (
            <FileNodeView key={node.path} node={node} depth={0} />
          ))}
          {files.length === 0 && <p className="px-2 py-1 text-sm text-stone-400">Repo files will appear here.</p>}
        </TreeSection>
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

function FileNodeView({ node, depth }: { node: FileNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const children = [...node.children.values()];
  const isFolder = node.type === "folder";

  if (isFolder) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-1 truncate rounded-lg px-2 py-1 font-mono text-xs text-stone-600 hover:bg-stone-100"
          style={{ paddingLeft: 8 + depth * 14 }}
          title={node.path}
          aria-expanded={open}
        >
          <span className="w-3 shrink-0 text-stone-400">{open ? "▾" : "▸"}</span>
          <span className="min-w-0 flex-1 truncate text-left">{node.name}</span>
          <span className="shrink-0 text-[10px] text-stone-400">{node.fileCount}</span>
        </button>
        {open && children.map((child) => <FileNodeView key={child.path} node={child} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div
      className="truncate rounded-lg px-2 py-1 font-mono text-xs text-stone-500"
      style={{ paddingLeft: 8 + depth * 14 }}
      title={node.path}
    >
      <span className="mr-1 text-stone-300">·</span>
      {node.name}
    </div>
  );
}

function TreeSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

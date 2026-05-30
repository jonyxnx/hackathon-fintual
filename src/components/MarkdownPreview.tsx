"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripLeadingH1 } from "@/lib/core/markdown";

export interface PreviewFile {
  filename: string;
  content: string;
}

interface Props {
  file: PreviewFile | null;
}

export function MarkdownPreview({ file }: Props) {
  if (!file) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-dashed border-stone-200 bg-white/70 text-sm text-stone-400">
        Select a generated doc to preview it.
      </div>
    );
  }

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-100 px-5 py-4">
        <p className="font-mono text-xs text-stone-400">{file.filename}</p>
      </div>
      <div className="prose prose-sm max-w-none flex-1 overflow-y-auto bg-white px-6 py-5 prose-headings:text-stone-950 prose-a:text-stone-900 prose-code:rounded prose-code:bg-stone-100 prose-code:px-1 prose-code:text-stone-800 prose-code:before:content-none prose-code:after:content-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripLeadingH1(file.content)}</ReactMarkdown>
      </div>
    </article>
  );
}

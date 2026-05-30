"use client";

import { useState } from "react";
import { ProviderSelect } from "@/components/ProviderSelect";

interface Props {
  disabled: boolean;
  onSubmit: (url: string, provider: "anthropic" | "openai") => void;
}

export function UrlForm({ disabled, onSubmit }: Props) {
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!url.trim()) return;
        onSubmit(url.trim(), provider);
      }}
    >
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-stone-300 bg-[#fffdf7] px-4 shadow-sm transition-colors focus-within:border-pink-400 focus-within:ring-4 focus-within:ring-pink-100">
          <span className="select-none font-mono text-sm text-pink-500">❯</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            disabled={disabled}
            className="min-w-0 flex-1 bg-transparent py-3 font-mono text-sm text-stone-900 outline-none placeholder:text-stone-400"
          />
        </label>
        <ProviderSelect value={provider} onChange={setProvider} disabled={disabled} />
        <button
          type="submit"
          disabled={disabled || !url.trim()}
          className="rounded-2xl bg-yellow-300 px-5 py-3 text-sm font-black text-stone-900 shadow-sm transition-colors hover:bg-yellow-200 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
        >
          {disabled ? "Working..." : "Generate docs"}
        </button>
      </div>
      <p className="text-xs leading-5 text-stone-500">
        kitdoc streams progress as it prepares markdown files for PR reviews,
        onboarding pages, and Notion handoffs.
      </p>
    </form>
  );
}

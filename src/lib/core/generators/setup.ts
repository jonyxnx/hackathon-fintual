import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks, depthGuidance, scaledTokens } from "./index";

const CANDIDATES = [
  "**/package.json",
  "**/pyproject.toml",
  "**/Gemfile",
  "**/go.mod",
  "**/Cargo.toml",
  "**/Makefile",
  "**/.env.example",
  "**/.env.sample",
  "**/env.example",
  "**/README.md",
  "**/docker-compose.yml",
  "**/compose.yml",
];

export const setup: Generator = {
  id: "setup",
  title: "Setup",
  filename: "setup.md",
  async run(ctx, llm, depth) {
    const found = await ctx.findFiles(CANDIDATES, 16);
    const signals = [...found];

    let fileBlocks = await buildFileBlocks(ctx, found, 16 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write a SHORT **Local setup** doc for \`${ctx.owner}/${ctx.repo}\` — just the essentials to get it running locally.

Files available:

${fileBlocks || "(no manifest detected — base it on metadata and file tree only)"}

Primary language: ${ctx.metadata.language ?? "unknown"}
Top-level directories: ${ctx.topDirs().join(", ") || "(none)"}

Produce a short doc (only what's clearly supported; omit empty sections):
1. \`# Local setup\` heading.
2. \`## Prerequisites\` — runtime/version and package manager, one line each.
3. \`## Install & run\` — the few commands to install and start it locally, from the real scripts/manifests.
4. \`## Environment\` — only the env vars that must be set, briefly. Skip if none.

Keep it tight: a developer should be able to skim it in under a minute.
${depthGuidance(depth)}`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(1600, depth) });
    return { filename: "setup.md", content, signals };
  },
};

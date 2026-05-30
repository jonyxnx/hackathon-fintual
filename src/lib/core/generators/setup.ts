import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

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
  async run(ctx, llm) {
    const found = await ctx.findFiles(CANDIDATES, 16);
    const signals = [...found];

    let fileBlocks = await buildFileBlocks(ctx, found, 16 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write the **Setup** documentation for \`${ctx.owner}/${ctx.repo}\`.

Files available:

${fileBlocks || "(no manifest detected — base it on metadata and file tree only)"}

Repo description: ${ctx.metadata.description ?? "(none)"}
Primary language: ${ctx.metadata.language ?? "unknown"}

Top-level directories: ${ctx.topDirs().join(", ") || "(none)"}

File tree (truncated):
\`\`\`
${ctx.fileTreePreview(220)}
\`\`\`

Produce comprehensive internal onboarding documentation. Cover every subsection below; when evidence is missing, say so explicitly instead of inventing commands or values.
1. \`# Setup\` heading.
2. \`## Prerequisites\` — runtime, language version, package manager, and system tools (only what's visible).
3. \`## Install\` — concrete install commands (npm/pnpm/yarn install, pip install, bundle install, etc.).
4. \`## Environment\` — env vars from examples/configs, grouped by purpose; never invent secret values.
5. \`## Run locally\` — dev server, worker, CLI, or container commands grounded in scripts and manifests.
6. \`## First-change workflow\` — recommended sequence: install, configure env, run, make a small change, verify.
7. \`## Useful scripts\` — what important scripts do and when to use each.
8. \`## Troubleshooting\` — likely setup issues visible from the repo and how to diagnose them.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 4500 });
    return { filename: "setup.md", content, signals };
  },
};

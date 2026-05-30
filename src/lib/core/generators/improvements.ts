import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

const SIGNAL_PATTERNS = [
  "**/package.json",
  "**/tsconfig*.json",
  "**/.eslintrc*",
  "**/eslint.config.*",
  "**/.github/workflows/*.{yml,yaml}",
  "**/Dockerfile",
  "**/README.md",
  "**/pyproject.toml",
  "**/go.mod",
];

export const improvements: Generator = {
  id: "improvements",
  title: "Improvements",
  filename: "improvements.md",
  async run(ctx, llm) {
    const configFiles = await ctx.findFiles(SIGNAL_PATTERNS, 16);
    const sampleFiles = ctx.sampleSourceFiles(20);
    const signals = [...new Set([...configFiles, ...sampleFiles])];

    let fileBlocks = await buildFileBlocks(ctx, signals, 12 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write an **Improvements** document for \`${ctx.owner}/${ctx.repo}\`.

This is a living, developer-facing backlog of things to improve in the codebase, based on a review of the repository. Be concrete and grounded in the evidence; when something is a hypothesis rather than confirmed, mark it clearly. Do not invent problems that the files do not support.

Repo description: ${ctx.metadata.description ?? "(none)"}
Primary language: ${ctx.metadata.language ?? "unknown"}
Top-level directories: ${ctx.topDirs().join(", ") || "(none)"}

File tree (truncated):
\`\`\`
${ctx.fileTreePreview(240)}
\`\`\`

Representative files:

${fileBlocks || "(no representative source files found)"}

Produce:
1. \`# Improvements\` heading.
2. \`## Summary\` - a short read on the overall health of the codebase.
3. \`## Code quality & tech debt\` - duplicated logic, oversized files/functions, unclear boundaries, dead code.
4. \`## Testing gaps\` - missing or thin test coverage and what should be tested first.
5. \`## Error handling & robustness\` - unhandled cases, missing validation, fragile assumptions visible in the code.
6. \`## Security\` - secrets handling, input validation, auth, and dependency risks visible from the files.
7. \`## Performance\` - obvious inefficiencies or scaling concerns supported by the evidence.
8. \`## Architecture & structure\` - structural improvements, module boundaries, and refactors worth doing.
9. \`## Dependencies & maintenance\` - outdated/unused dependencies, lockfile/build hygiene, and CI gaps.
10. \`## Documentation gaps\` - what is undocumented or unclear for a new developer or agent.
11. \`## Prioritized action list\` - a ranked, checkbox list of concrete next steps (most impactful first), each with the files/areas it touches.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 5000 });
    return { filename: "improvements.md", content, signals };
  },
};

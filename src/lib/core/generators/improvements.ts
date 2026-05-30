import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks, depthGuidance, scaledTokens } from "./index";

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
  async run(ctx, llm, depth) {
    const configFiles = await ctx.findFiles(SIGNAL_PATTERNS, 16);
    const sampleFiles = ctx.sampleSourceFiles(20);
    const signals = [...new Set([...configFiles, ...sampleFiles])];

    let fileBlocks = await buildFileBlocks(ctx, signals, 12 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write a SHORT **Improvements** doc for \`${ctx.owner}/${ctx.repo}\` — the most important things worth improving, based on a review.

Primary language: ${ctx.metadata.language ?? "unknown"}

File tree (truncated):
\`\`\`
${ctx.fileTreePreview(200)}
\`\`\`

Representative files:

${fileBlocks || "(no representative source files found)"}

Produce a short, prioritized doc — do NOT list everything, only what's worth a developer's time:
1. \`# Improvements\` heading.
2. \`## Top improvements\` - a ranked checkbox list of the most impactful items (tech debt, testing gaps, risks, structure). One line each, name the files/areas it touches. Mark guesses as guesses.
3. \`## Nice to have\` - a few smaller, optional items. Skip this section if there's nothing notable.

Be concrete and grounded in the files. Don't invent problems.
${depthGuidance(depth)}`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(1800, depth) });
    return { filename: "improvements.md", content, signals };
  },
};

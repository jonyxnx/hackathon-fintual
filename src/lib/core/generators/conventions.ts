import type { Generator } from "./index";
import {
  SYSTEM_PROMPT,
  buildBroadContext,
  buildFileBlocks,
  depthGuidance,
  scaledContext,
  scaledTokens,
} from "./index";

const CONFIG_PATTERNS = [
  "**/.eslintrc",
  "**/.eslintrc.{js,cjs,json,yml,yaml}",
  "**/eslint.config.{js,mjs,cjs,ts}",
  "**/.prettierrc",
  "**/.prettierrc.{json,js,yaml,yml}",
  "**/prettier.config.{js,cjs,mjs}",
  "**/.editorconfig",
  "**/tsconfig*.json",
  "**/biome.{json,jsonc}",
  "**/pyproject.toml",
  "**/setup.cfg",
  "**/.rubocop.yml",
  "**/.pylintrc",
  "**/.flake8",
  "**/.golangci.{yml,yaml}",
  "**/rustfmt.toml",
  "**/.rustfmt.toml",
  "**/.clang-format",
  "**/package.json",
];

export const conventions: Generator = {
  id: "conventions",
  title: "Conventions",
  filename: "conventions.md",
  async run(ctx, llm, depth) {
    const configFiles = await ctx.findFiles(CONFIG_PATTERNS, scaledContext(20, depth, 8));
    const sampleFiles = ctx.sampleSourceFiles(scaledContext(24, depth, 10));
    const signals = [...configFiles, ...sampleFiles];

    let fileBlocks = await buildFileBlocks(ctx, signals, {
      perFileMax: scaledContext(14 * 1024, depth, 5 * 1024),
      maxFiles: scaledContext(36, depth, 12),
    });
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx, 6, depth);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write a SHORT **Codebase patterns** doc for \`${ctx.owner}/${ctx.repo}\` — focus on how the code is shaped, where logic lives, and how developers should make changes.

Detected config files:
${configFiles.map((f) => "- `" + f + "`").join("\n") || "- none"}

Representative source files:
${sampleFiles.map((f) => "- `" + f + "`").join("\n") || "- none"}

${fileBlocks}

Produce a short doc based mostly on the source files, not just config/env vars. Only include patterns you actually see in the repo:
1. \`# Codebase patterns\` heading.
2. \`## Function and module shape\` — how functions/components/classes/services are usually structured (exports, parameters, async style, return shapes, naming). Use short bullets with file examples.
3. \`## Where logic lives\` — where business logic, API handlers, UI logic, data access, services, and helpers live. Mention the important files/folders only.
4. \`## Error handling and boundaries\` — how errors, validation, empty states, external calls, and edge cases are handled in the code you saw.
5. \`## Tooling and formatting\` — only the important lint/format/type rules. Keep this small; do not let config/env vars dominate the page.
6. \`## Watch out for\` — real gotchas or anti-patterns from the repo.

Keep it short and concrete. Don't restate generic best practices and don't list every file — explain the shapes that matter.
${depthGuidance(depth)}`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(2200, depth) });
    return { filename: "conventions.md", content, signals };
  },
};

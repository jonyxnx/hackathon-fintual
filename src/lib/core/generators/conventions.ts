import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks, depthGuidance, scaledTokens } from "./index";

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
    const configFiles = await ctx.findFiles(CONFIG_PATTERNS, 20);
    const sampleFiles = ctx.sampleSourceFiles(16);
    const signals = [...configFiles, ...sampleFiles];

    let fileBlocks = await buildFileBlocks(ctx, signals, 12 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write a SHORT **Codebase patterns** doc for \`${ctx.owner}/${ctx.repo}\` — only the conventions that actually matter here.

Detected config files:
${configFiles.map((f) => "- `" + f + "`").join("\n") || "- none"}

${fileBlocks}

Produce a short doc (only what's supported by the config/code; omit empty sections):
1. \`# Codebase patterns\` heading.
2. \`## Tooling\` — linter/formatter/language config that's set up, one line each.
3. \`## Conventions that matter\` — the handful of patterns a new dev must follow (naming, structure, error handling, etc.) as short bullets.
4. \`## Watch out for\` — a few real gotchas or anti-patterns to avoid here.

Keep it short and concrete. Don't restate generic best practices — only what's specific to this repo.
${depthGuidance(depth)}`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(1800, depth) });
    return { filename: "conventions.md", content, signals };
  },
};

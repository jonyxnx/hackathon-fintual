import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

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
  async run(ctx, llm) {
    const configFiles = await ctx.findFiles(CONFIG_PATTERNS, 20);
    const sampleFiles = ctx.sampleSourceFiles(16);
    const signals = [...configFiles, ...sampleFiles];

    let fileBlocks = await buildFileBlocks(ctx, signals, 12 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write the **Conventions** documentation for \`${ctx.owner}/${ctx.repo}\`.

The repository was explored from the cloned checkout. Use explicit tooling config and representative source files when available.

Detected config files:
${configFiles.map((f) => "- `" + f + "`").join("\n") || "- none"}

Representative source files analyzed:
${sampleFiles.map((f) => "- `" + f + "`").join("\n") || "- none"}

${fileBlocks}

Produce comprehensive internal engineering guidance. Cover every subsection below; infer cautiously from sampled code when config is absent.
1. \`# Conventions\` heading.
2. \`## Tooling\` — linters, formatters, compilers, package scripts, and where they are configured.
3. \`## Formatting\` — indentation, quotes, semicolons, trailing commas, import style, naming, and component/function style.
4. \`## Language / compiler settings\` — TypeScript strict flags, Python version, lint targets, etc. (only what's visible).
5. \`## Code patterns observed\` — module boundaries, component/function style, error handling, async/data flow, naming, and file organization.
6. \`## Conventions to follow\` — actionable bullets for a new developer making changes in this repo.
7. \`## Review checklist\` — concrete checks a reviewer should apply before approving changes.
8. \`## Things to avoid\` — risky changes or style mismatches that would conflict with the observed codebase.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 5000 });
    return { filename: "conventions.md", content, signals };
  },
};

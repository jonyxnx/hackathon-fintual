import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

const CONFIG_PATTERNS = [
  "**/jest.config.{js,ts,mjs,cjs}",
  "**/vitest.config.{js,ts,mjs,cjs}",
  "**/playwright.config.{js,ts}",
  "**/cypress.config.{js,ts}",
  "**/pytest.ini",
  "**/tox.ini",
  "**/karma.conf.js",
  "**/mocha.opts",
  "**/.mocharc.{js,json}",
  "**/spec/spec_helper.rb",
];

const TEST_GLOBS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "tests/**/*.py",
  "test/**/*.rb",
  "__tests__/**/*",
];

export const testing: Generator = {
  id: "testing",
  title: "Testing",
  filename: "testing.md",
  async run(ctx, llm) {
    const configs = await ctx.findFiles(CONFIG_PATTERNS, 12);
    const packageFiles = await ctx.findFiles(["**/package.json"], 8);

    let testFileCount = 0;
    const sampleTests: string[] = [];
    for (const pattern of TEST_GLOBS) {
      const matches = await ctx.glob(pattern);
      testFileCount += matches.length;
      if (sampleTests.length < 3 && matches.length > 0) {
        sampleTests.push(matches[0]);
      }
    }

    const testScripts: string[] = [];
    for (const pkgPath of packageFiles) {
      const pkg = await ctx.readJson<{ scripts?: Record<string, string> }>(pkgPath);
      if (!pkg?.scripts) continue;
      for (const [name, command] of Object.entries(pkg.scripts)) {
        if (/^(test|coverage|e2e|lint|typecheck|check|build)/i.test(name)) {
          testScripts.push(`${pkgPath} ${name}: ${command}`);
        }
      }
    }

    const signals = [...configs, ...packageFiles, ...sampleTests];
    const dedicatedSignals = configs.length > 0 || testFileCount > 0 || testScripts.length > 0;

    let fileBlocks = await buildFileBlocks(ctx, [...configs, ...packageFiles, ...sampleTests], 8 * 1024);
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = fallback.blocks;
      signals.push(...fallback.paths);
    }

    const user = `Write the **Testing** documentation for \`${ctx.owner}/${ctx.repo}\`.

Detected:
- Test config files: ${configs.length ? configs.join(", ") : "none"}
- Approx test files found: ${testFileCount}
- Sample tests: ${sampleTests.join(", ") || "none"}
- Quality-related scripts: ${testScripts.join(" | ") || "none"}
- Dedicated testing signals found: ${dedicatedSignals ? "yes" : "no — rely on README/manifest hints and state unknowns explicitly"}

File contents:

${fileBlocks || "(none — rely on scripts/counts above)"}

Produce comprehensive internal testing guidance. Cover every subsection below; when evidence is missing, say so explicitly instead of inventing frameworks or commands.
1. \`# Testing\` heading.
2. \`## Test frameworks\` — what's used (Jest, Vitest, Playwright, pytest, etc.).
3. \`## How to run tests\` — concrete commands grounded in the scripts/configs above, including targeted vs full-suite commands when visible.
4. \`## Test structure\` — where tests live, naming convention, and what sample tests reveal about style.
5. \`## What to test when changing code\` — practical guidance for a new developer or coding agent based on detected files.
6. \`## Coverage & CI\` — only if visible from configs / scripts; otherwise note that coverage/CI testing is unknown.
7. \`## Quality gates\` — lint/typecheck/build/test commands a developer should run before handing off work.
8. \`## Agent notes\` — what a coding agent should verify after modifying app code, configuration, database code, or deployment files.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 4500 });
    return { filename: "testing.md", content, signals };
  },
};

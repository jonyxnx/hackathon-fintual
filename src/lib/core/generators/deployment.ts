import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks, depthGuidance, scaledTokens } from "./index";

const PATTERN_GROUPS = [
  ["Dockerfile", "Dockerfile.*", "**/Dockerfile"],
  ["docker-compose.yml", "docker-compose.*.yml", "compose.yml", "compose.*.yml"],
  [".github/workflows/*.yml", ".github/workflows/*.yaml"],
  ["vercel.json"],
  ["render.yaml", "render.yml"],
  ["netlify.toml"],
  ["fly.toml"],
  ["Procfile"],
  ["app.yaml"],
  ["serverless.yml", "serverless.yaml"],
  ["**/*.tf"],
  ["k8s/**/*.yaml", "k8s/**/*.yml", "deploy/**/*.yaml"],
  ["railway.json", "railway.toml"],
];

export const deployment: Generator = {
  id: "deployment",
  title: "Deployment",
  filename: "deployment.md",
  async run(ctx, llm, depth) {
    const found = new Set<string>();
    for (const group of PATTERN_GROUPS) {
      const matches = await ctx.glob(group as string[]);
      for (const m of matches) found.add(m);
    }
    const foundList = [...found].slice(0, 20);
    const signals = [...foundList];

    let fileBlocks = foundList.length > 0 ? await buildFileBlocks(ctx, foundList, 8 * 1024) : "";
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = [
        "_No dedicated deployment or CI config files were detected. Use README/manifest hints and state unknowns explicitly._",
        "",
        fallback.blocks,
        "",
        "File tree (truncated):",
        "```",
        ctx.fileTreePreview(220),
        "```",
      ].join("\n");
      signals.push(...fallback.paths);
    }

    const user = `Write a SHORT **Deployment** doc for \`${ctx.owner}/${ctx.repo}\` — only what a developer needs to ship it.

Detected deployment-related files: ${foundList.length ? foundList.join(", ") : "none"}

${fileBlocks}

Produce a short doc (only what's clearly configured; omit empty sections):
1. \`# Deployment\` heading.
2. \`## Where it runs\` — the platform(s)/CI actually configured. If nothing indicates this is deployable, say so in one line and stop.
3. \`## How to deploy\` — the key steps, grounded in the configs above.
4. \`## Environment\` — the required env vars/secrets, briefly. Skip if none.

Keep it tight and concrete. Don't invent platforms or commands.
${depthGuidance(depth)}`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: scaledTokens(1600, depth) });
    return { filename: "deployment.md", content, signals };
  },
};

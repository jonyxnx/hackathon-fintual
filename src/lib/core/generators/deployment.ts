import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

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
  async run(ctx, llm) {
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

    const user = `Write the **Deployment** documentation for \`${ctx.owner}/${ctx.repo}\`.

Detected deployment-related files: ${foundList.length ? foundList.join(", ") : "none"}

${fileBlocks}

Produce comprehensive internal deployment and operations guidance. Cover every subsection below; when evidence is missing, say so explicitly instead of inventing platforms or commands.
1. \`# Deployment\` heading.
2. \`## Hosting / platforms\` — Vercel, Render, Fly, AWS, k8s, etc. (only what's actually configured or clearly referenced).
3. \`## CI/CD\` — workflows, triggers, jobs, build/test/deploy steps, and what each pipeline appears responsible for.
4. \`## Runtime shape\` — containers, serverless/runtime config, build artifacts, ports, process commands, and deployment entrypoints if visible.
5. \`## Environment variables\` — env vars referenced in configs, grouped by purpose when possible; do not invent values.
6. \`## How to deploy\` — concrete steps a company developer would follow, grounded in the above.
7. \`## Operational notes\` — risks, external services, secrets, migrations, or manual steps visible from configs.
8. \`## Agent checklist\` — what a coding agent should inspect before changing deployment or CI files.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 4500 });
    return { filename: "deployment.md", content, signals };
  },
};

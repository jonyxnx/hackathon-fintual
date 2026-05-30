import type { Generator } from "./index";
import { SYSTEM_PROMPT, buildBroadContext, buildFileBlocks } from "./index";

const SIGNAL_PATTERNS = [
  "**/prisma/schema.prisma",
  "**/drizzle.config.{ts,js,mjs}",
  "**/alembic.ini",
  "**/knexfile.{js,ts}",
  "**/db/schema.rb",
  "**/config/database.yml",
  "**/sequelize.config.js",
  "**/typeorm.config.ts",
  "**/ormconfig.json",
  "**/supabase/config.toml",
];

const FOLDER_PATTERNS = [
  "prisma/migrations/**/*.sql",
  "drizzle/**/*.sql",
  "migrations/**/*.sql",
  "migrations/**/*.py",
  "migrations/**/*.rb",
  "db/migrate/**/*.rb",
  "alembic/versions/**/*.py",
  "supabase/migrations/**/*.sql",
];

export const migrations: Generator = {
  id: "migrations",
  title: "Migrations",
  filename: "migrations.md",
  async run(ctx, llm) {
    const found = new Set<string>();
    for (const p of await ctx.findFiles(SIGNAL_PATTERNS, 20)) found.add(p);
    const sampleMigrations: string[] = [];
    for (const pattern of FOLDER_PATTERNS) {
      const matches = await ctx.glob(pattern);
      for (const m of matches) found.add(m);
      sampleMigrations.push(...matches.slice(0, 2));
    }

    const foundList = [...found].slice(0, 15);
    const signals = [...foundList];

    const filesToRead = [
      ...[...found].filter((p) => !sampleMigrations.includes(p)),
      ...sampleMigrations.slice(0, 3),
    ];
    let fileBlocks = filesToRead.length > 0 ? await buildFileBlocks(ctx, filesToRead, 12 * 1024) : "";
    if (!fileBlocks) {
      const fallback = await buildBroadContext(ctx);
      fileBlocks = [
        "_No dedicated database or migration files were detected. Use README/manifest hints and state unknowns explicitly._",
        "",
        fallback.blocks,
      ].join("\n");
      signals.push(...fallback.paths);
    }

    const user = `Write the **Migrations** documentation for \`${ctx.owner}/${ctx.repo}\`.

Detected files:
${foundList.length ? foundList.map((f) => "- `" + f + "`").join("\n") : "- none"}

Contents of key files:

${fileBlocks}

Produce comprehensive internal database guidance. Cover every subsection below; when evidence is missing, say so explicitly instead of inventing ORMs or commands.
1. \`# Migrations\` heading.
2. \`## ORM / tooling\` — which ORM and migration tool (Prisma, Drizzle, Alembic, etc.).
3. \`## Schema overview\` — the main models/tables visible in schema or migrations, with short descriptions grounded in names/fields.
4. \`## How migrations work\` — where migrations live, naming/versioning pattern, and workflow to create/apply them for this stack.
5. \`## Local development workflow\` — how a developer should prepare, migrate, reset, seed, or inspect the database when commands/configs are visible.
6. \`## Common commands\` — concrete CLI commands a developer would run (e.g., \`npx prisma migrate dev\`).
7. \`## Change safety\` — cautions for schema changes, destructive operations, generated clients, and deployment ordering visible from files.
8. \`## Agent notes\` — what a coding agent should verify before editing schema, migration, or database access code.`;

    const content = await llm.complete({ system: SYSTEM_PROMPT, user, maxTokens: 4500 });
    return { filename: "migrations.md", content, signals };
  },
};

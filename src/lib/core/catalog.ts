export interface GeneratorMeta {
  id: string;
  title: string;
  filename: string;
  description: string;
  detects: string[];
}

/** Canonical six-part project documentation scope (matches product copy). */
export const DOC_PACK_SECTIONS = [
  "overview",
  "setup",
  "testing",
  "deployment",
  "conventions",
  "migrations",
] as const;

export type DocPackSectionId = (typeof DOC_PACK_SECTIONS)[number];

export const GENERATOR_CATALOG: GeneratorMeta[] = [
  {
    id: "overview",
    title: "Overview",
    filename: "overview.md",
    description:
      "What the project does, the tech stack, repo layout, entry points, and how pieces fit together.",
    detects: ["README.md", "package.json", "pyproject.toml", "language stats"],
  },
  {
    id: "setup",
    title: "Setup",
    filename: "setup.md",
    description: "Prerequisites, install, environment variables, local run, and first-change workflow.",
    detects: ["package.json scripts", ".env.example", "Makefile", "README install"],
  },
  {
    id: "testing",
    title: "Testing",
    filename: "testing.md",
    description: "Test frameworks, how to run tests, test layout, coverage, and quality gates.",
    detects: ["jest.config*", "vitest.config*", "pytest.ini", "playwright.config*", "__tests__/"],
  },
  {
    id: "deployment",
    title: "Deployment",
    filename: "deployment.md",
    description: "Hosting platforms, CI/CD workflows, containers, runtime shape, and env vars.",
    detects: ["Dockerfile", ".github/workflows/*", "vercel.json", "render.yaml", "fly.toml"],
  },
  {
    id: "conventions",
    title: "Conventions",
    filename: "conventions.md",
    description: "Linting, formatting, language settings, and coding patterns to follow in this repo.",
    detects: [".eslintrc*", ".prettierrc*", "tsconfig.json", ".editorconfig", "biome.json"],
  },
  {
    id: "migrations",
    title: "Migrations",
    filename: "migrations.md",
    description: "ORM in use, schema overview, and how to create and apply database migrations.",
    detects: ["prisma/schema.prisma", "drizzle.config", "alembic.ini", "migrations/"],
  },
];

export function getCatalogEntry(id: string): GeneratorMeta | undefined {
  return GENERATOR_CATALOG.find((g) => g.id === id);
}

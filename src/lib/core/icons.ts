/**
 * Pick a Notion page emoji icon based on a folder's path / likely usage.
 * The match is on the last path segment first, then on any segment, so that
 * `src/lib/core/llm` resolves to the LLM icon even though it is nested.
 */

interface IconRule {
  emoji: string;
  patterns: RegExp[];
}

const RULES: IconRule[] = [
  { emoji: "🔌", patterns: [/^api$/, /^apis$/, /^endpoints?$/, /^routes?$/, /^router$/] },
  { emoji: "🧩", patterns: [/^components?$/, /^ui$/, /^widgets?$/, /^elements?$/] },
  { emoji: "🪝", patterns: [/^hooks?$/] },
  { emoji: "🎨", patterns: [/^styles?$/, /^css$/, /^scss$/, /^theme(s)?$/, /^design$/] },
  { emoji: "🖼️", patterns: [/^public$/, /^assets?$/, /^static$/, /^images?$/, /^media$/, /^icons?$/, /^fonts?$/] },
  { emoji: "🤖", patterns: [/^llm$/, /^ai$/, /^agents?$/, /^ml$/, /^models?$/, /^prompts?$/] },
  { emoji: "🏭", patterns: [/^generators?$/, /^factories?$/, /^builders?$/] },
  { emoji: "🖥️", patterns: [/^server$/, /^backend$/, /^services?$/] },
  { emoji: "💻", patterns: [/^client$/, /^frontend$/, /^web$/] },
  { emoji: "⌨️", patterns: [/^cli$/, /^bin$/, /^commands?$/] },
  { emoji: "📱", patterns: [/^app$/, /^pages?$/, /^screens?$/, /^views?$/] },
  { emoji: "🧰", patterns: [/^utils?$/, /^helpers?$/, /^common$/, /^shared$/, /^tools?$/] },
  { emoji: "📚", patterns: [/^lib$/, /^libs$/, /^packages?$/, /^modules?$/, /^vendor$/] },
  { emoji: "⚙️", patterns: [/^core$/, /^config$/, /^configs?$/, /^settings?$/, /^engine$/] },
  { emoji: "🗄️", patterns: [/^db$/, /^database$/, /^migrations?$/, /^prisma$/, /^schema(s)?$/, /^sql$/] },
  { emoji: "🗃️", patterns: [/^store$/, /^stores?$/, /^state$/, /^redux$/, /^context$/] },
  { emoji: "🏷️", patterns: [/^types?$/, /^typings?$/, /^interfaces?$/, /^@types$/] },
  { emoji: "🧪", patterns: [/^tests?$/, /^__tests__$/, /^spec$/, /^specs$/, /^e2e$/, /^fixtures?$/, /^mocks?$/] },
  { emoji: "📝", patterns: [/^docs?$/, /^documentation$/, /^content$/] },
  { emoji: "📜", patterns: [/^scripts?$/, /^tasks?$/, /^jobs?$/] },
  { emoji: "🔄", patterns: [/^\.github$/, /^workflows?$/, /^actions?$/, /^ci$/, /^pipelines?$/] },
  { emoji: "📦", patterns: [/^dist$/, /^build$/, /^out$/, /^\.next$/, /^release$/] },
  { emoji: "🔐", patterns: [/^auth$/, /^security$/, /^secrets?$/] },
  { emoji: "🧭", patterns: [/^middleware$/, /^navigation$/, /^guards?$/] },
  { emoji: "🌐", patterns: [/^locales?$/, /^i18n$/, /^translations?$/, /^lang$/] },
];

export const REPO_ICON = "📦";
export const AGENTS_ICON = "🤖";
export const FILE_ICON = "📄";

const DEFAULT_ICON = "📁";

const FILE_ICON_BY_EXT: Record<string, string> = {
  ".ts": "🟦",
  ".tsx": "⚛️",
  ".js": "🟨",
  ".jsx": "⚛️",
  ".mjs": "🟨",
  ".cjs": "🟨",
  ".py": "🐍",
  ".rb": "💎",
  ".go": "🐹",
  ".rs": "🦀",
  ".java": "☕",
  ".kt": "🟪",
  ".swift": "🐦",
  ".php": "🐘",
  ".css": "🎨",
  ".scss": "🎨",
  ".html": "🌐",
  ".md": "📝",
  ".mdx": "📝",
  ".json": "🗂️",
  ".yml": "🔧",
  ".yaml": "🔧",
  ".toml": "🔧",
  ".env": "🔐",
  ".sh": "📜",
  ".sql": "🗄️",
  ".prisma": "🗄️",
  ".dockerfile": "🐳",
};

const FILE_ICON_BY_NAME: Array<[RegExp, string]> = [
  [/^readme/i, "📖"],
  [/^license/i, "⚖️"],
  [/^dockerfile$/i, "🐳"],
  [/^makefile$/i, "🛠️"],
  [/^package\.json$/i, "📦"],
  [/^tsconfig.*\.json$/i, "🔧"],
  [/\.test\.|\.spec\./i, "🧪"],
  [/^\.env/i, "🔐"],
];

export function iconForFile(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  for (const [pattern, emoji] of FILE_ICON_BY_NAME) {
    if (pattern.test(name)) return emoji;
  }
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
  return FILE_ICON_BY_EXT[ext] ?? FILE_ICON;
}

export function iconForPath(dirPath: string): string {
  const segments = dirPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase());

  if (segments.length === 0) return REPO_ICON;

  const last = segments[segments.length - 1];

  // Prefer a match on the most specific (last) segment.
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(last))) return rule.emoji;
  }

  // Fall back to any matching ancestor segment.
  for (const segment of segments) {
    for (const rule of RULES) {
      if (rule.patterns.some((p) => p.test(segment))) return rule.emoji;
    }
  }

  return DEFAULT_ICON;
}

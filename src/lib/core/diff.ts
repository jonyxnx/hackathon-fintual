import simpleGit from "simple-git";

const IGNORED_TOP_DIRS = new Set([".git", ".next", "build", "dist", "node_modules"]);
/** Sentinel for root-level file changes (README.md, package.json, etc.). */
export const ROOT_CHANGE = ".";

export async function changedTopDirs(dir: string, baseRef: string, headRef: string): Promise<string[]> {
  const git = simpleGit(dir);
  const output = await git.diff(["--name-only", `${baseRef}...${headRef}`]);
  const dirs = new Set<string>();

  for (const changedPath of output.split(/\r?\n/)) {
    const trimmed = changedPath.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("/");
    const topDir = parts[0];
    if (!topDir || IGNORED_TOP_DIRS.has(topDir)) continue;

    if (parts.length === 1) {
      dirs.add(ROOT_CHANGE);
      continue;
    }

    dirs.add(topDir);
  }

  return [...dirs].sort();
}

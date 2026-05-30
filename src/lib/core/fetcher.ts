import { Octokit } from "@octokit/rest";
import fg from "fast-glob";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import type { ParsedRepo } from "./url";

export interface RepoMetadata {
  defaultBranch: string;
  description: string | null;
  language: string | null;
  languages: Record<string, number>;
  stars: number;
  topics: string[];
  license: string | null;
}

export interface FetchedRepo {
  parsed: Required<ParsedRepo>;
  tempDir: string;
  fileTree: string[];
  metadata: RepoMetadata;
  cleanup: () => Promise<void>;
}

function makeOctokit() {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
  });
}

function archiveDataToBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") return Buffer.from(data, "binary");
  throw new Error("Unexpected GitHub archive response.");
}

async function downloadAndExtractTarball(
  octokit: ReturnType<typeof makeOctokit>,
  owner: string,
  repo: string,
  ref: string,
  tempDir: string,
): Promise<void> {
  const response = await octokit.repos.downloadTarballArchive({ owner, repo, ref });
  const archivePath = path.join(tempDir, "repo.tar.gz");
  await writeFile(archivePath, archiveDataToBuffer(response.data));
  await tar.x({
    file: archivePath,
    cwd: tempDir,
    strip: 1,
  });
  await rm(archivePath, { force: true });
}

export async function fetchRepo(parsed: ParsedRepo): Promise<FetchedRepo> {
  const octokit = makeOctokit();

  const repoInfo = await octokit.repos
    .get({ owner: parsed.owner, repo: parsed.repo })
    .catch((err) => {
      if (err.status === 404)
        throw new Error(
          `Repo not found or private without GITHUB_TOKEN: ${parsed.owner}/${parsed.repo}`,
        );
      throw err;
    });

  const defaultBranch = repoInfo.data.default_branch;
  const ref = parsed.ref || defaultBranch;

  const langs = await octokit.repos
    .listLanguages({ owner: parsed.owner, repo: parsed.repo })
    .catch(() => ({ data: {} as Record<string, number> }));

  const topics = (repoInfo.data.topics as string[] | undefined) ?? [];

  const tempDir = await mkdtemp(path.join(tmpdir(), "auto-doc-"));
  try {
    await downloadAndExtractTarball(octokit, parsed.owner, parsed.repo, ref, tempDir);
  } catch {
    await downloadAndExtractTarball(octokit, parsed.owner, parsed.repo, defaultBranch, tempDir);
  }

  const fileTree = await fg("**/*", {
    cwd: tempDir,
    dot: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "**/build/**"],
    followSymbolicLinks: false,
  });

  return {
    parsed: { owner: parsed.owner, repo: parsed.repo, ref },
    tempDir,
    fileTree,
    metadata: {
      defaultBranch,
      description: repoInfo.data.description ?? null,
      language: repoInfo.data.language ?? null,
      languages: langs.data,
      stars: repoInfo.data.stargazers_count ?? 0,
      topics,
      license: repoInfo.data.license?.name ?? null,
    },
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

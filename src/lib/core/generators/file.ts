import path from "node:path";

/** Extensions and filenames that should not count toward documentation. */
const SKIP_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".avif",
  ".bmp",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".zip",
  ".gz",
  ".tar",
  ".jar",
  ".wasm",
  ".map",
  ".lock",
]);

const SKIP_NAME_PATTERNS = [
  /^package-lock\.json$/i,
  /^yarn\.lock$/i,
  /^pnpm-lock\.yaml$/i,
  /\.min\.(js|css)$/i,
  /^\.ds_store$/i,
  /\.tsbuildinfo$/i,
];

/**
 * Whether a file counts as "real" source/content for documentation purposes.
 * Used to decide whether a folder has enough substance to earn its own doc page;
 * assets, lockfiles, and build artifacts are ignored.
 */
export function isDocumentableFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? filePath;
  if (SKIP_NAME_PATTERNS.some((p) => p.test(name))) return false;
  const ext = path.extname(name).toLowerCase();
  if (SKIP_EXTS.has(ext)) return false;
  return true;
}

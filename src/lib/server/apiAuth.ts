/** Returns an error response when the request is not authorized, or null when allowed. */
export function unauthorizedResponse(req: Request): Response | null {
  const requiredKey = process.env.KITDOC_API_KEY?.trim();
  if (!requiredKey) return null;

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${requiredKey}`) return null;

  const headerKey = req.headers.get("x-kitdoc-api-key");
  if (headerKey === requiredKey) return null;

  return new Response("Unauthorized", { status: 401 });
}

export const ZIP_MAX_FILES = 200;
export const ZIP_MAX_TOTAL_CHARS = 8 * 1024 * 1024;
export const ZIP_MAX_BODY_BYTES = 10 * 1024 * 1024;

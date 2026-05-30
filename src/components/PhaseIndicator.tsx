import type { Phase } from "@/lib/core/webRun";

const PHASE_ORDER: Phase[] = ["parsing", "fetching", "ready"];

function progressPercent(
  phase: Phase | "generating" | "complete",
  doneCount: number,
): number {
  if (phase === "complete") return 100;
  if (phase === "generating") return Math.min(92, 48 + doneCount * 5);
  const idx = PHASE_ORDER.indexOf(phase);
  return idx >= 0 ? [18, 38, 48][idx] : 12;
}

function statusLabel(
  phase: Phase | "generating" | "complete",
  target: string | null | undefined,
  currentDoc: string | undefined,
  doneCount: number,
): string {
  if (phase === "complete") return "Done";
  if (phase === "generating") {
    if (currentDoc) return currentDoc;
    if (doneCount > 0) return `${doneCount} docs`;
    return "Writing";
  }
  if (phase === "fetching" && target) return target;
  return { parsing: "Parsing", fetching: "Fetching", ready: "Preparing" }[phase] ?? "Working";
}

export function PhaseIndicator({
  phase,
  target,
  currentDoc,
  doneCount = 0,
}: {
  phase: Phase | "generating" | "complete" | null;
  target?: string | null;
  currentDoc?: string;
  doneCount?: number;
}) {
  if (!phase || phase === "complete") return null;

  const pct = progressPercent(phase, doneCount);
  const label = statusLabel(phase, target, currentDoc, doneCount);

  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white/80 px-3 py-2">
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full rounded-full bg-stone-800 transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="max-w-[45%] shrink-0 truncate text-xs text-stone-500">{label}</span>
    </div>
  );
}

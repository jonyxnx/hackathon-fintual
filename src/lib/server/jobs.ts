import { randomUUID } from "node:crypto";
import type { GeneratorResult } from "@/lib/core/generators";

interface Job {
  id: string;
  zip?: Buffer;
  results?: GeneratorResult[];
  createdAt: number;
}

const jobs = new Map<string, Job>();
const TTL_MS = 30 * 60 * 1000;

export function createJob(): string {
  const id = randomUUID();
  jobs.set(id, { id, createdAt: Date.now() });
  sweep();
  return id;
}

export function setJobArtifact(id: string, zip: Buffer, results: GeneratorResult[]) {
  const job = jobs.get(id);
  if (!job) {
    console.warn(`[kitdoc] Job ${id} expired before zip artifact could be stored.`);
    return;
  }
  job.zip = zip;
  job.results = results;
}

export function getJob(id: string): Job | undefined {
  sweep();
  return jobs.get(id);
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

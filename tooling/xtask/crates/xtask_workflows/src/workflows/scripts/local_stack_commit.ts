// Picks the main commit `Push local stack binaries` builds: the newest one whose
// `Deploy on Push` run built every service's binaries and the shared
// dependencies, which that run pushed to the Nix cache. The local stack reuses
// those closures, so building that commit compiles only the local-only
// binaries. Most `Deploy on Push` runs are cancelled while they wait, so main's
// head usually has none of its closures in the cache.
//
// Writes `sha=<commit>` to the step outputs: main's head when no recent run
// qualifies, which builds everything, as before.

import { appendFileSync } from 'node:fs';

const API = 'https://api.github.com';
const DEPLOY_WORKFLOW = 'deploy_on_push.yml';
// Runs to look back through; one per main push.
const RUNS = 30;
const PREFIX = 'Deploy Cloud Storage Services / ';
export const WARM_JOB = `${PREFIX}Warm shared binary deps onto sticky disk`;
const BUILD_JOB = new RegExp(`^${PREFIX}Build \\S+ binaries$`);

export type Run = { id: number; head_sha: string };
export type Job = { name: string; status: string; conclusion: string | null };

/** Whether a run built and pushed the shared dependencies and every service's binaries. */
export function builtBinaries(jobs: Job[]): boolean {
  const passed = (job: Job) => job.status === 'completed' && job.conclusion === 'success';
  const builds = jobs.filter((job) => BUILD_JOB.test(job.name));
  const warm = jobs.find((job) => job.name === WARM_JOB);
  return warm !== undefined && passed(warm) && builds.length > 0 && builds.every(passed);
}

/** The newest run, of `runs` ordered newest first, that built its binaries. */
export async function pick(
  runs: Run[],
  jobsOf: (run: Run) => Promise<Job[]>,
): Promise<Run | undefined> {
  for (const run of runs) if (builtBinaries(await jobsOf(run))) return run;
  return undefined;
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API}/repos/${env('GITHUB_REPOSITORY')}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env('GH_TOKEN')}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function main(): Promise<void> {
  const head = env('MAIN_SHA');
  let sha = head;
  try {
    const { workflow_runs: runs } = await get<{ workflow_runs: Run[] }>(
      `/actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=main&event=push&per_page=${RUNS}`,
    );
    const run = await pick(runs, async ({ id }) =>
      (await get<{ jobs: Job[] }>(`/actions/runs/${id}/jobs?per_page=100`)).jobs,
    );
    if (run) {
      sha = run.head_sha;
      console.log(`Building ${sha}, whose binaries Deploy on Push run ${run.id} built`);
    } else {
      console.log(`::warning::No recent Deploy on Push run built its binaries; building main's head ${head}`);
    }
  } catch (error) {
    console.log(`::warning::Could not read Deploy on Push runs (${String(error)}); building main's head ${head}`);
  }
  appendFileSync(env('GITHUB_OUTPUT'), `sha=${sha}\n`);
}

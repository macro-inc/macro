// Tells the Macro Alerts channel when a production release's desktop
// installers never arrive. `Desktop Release Watch` runs it every hour.
//
// `Build Desktop on Tag` attaches the installers to the release of the tag it
// builds, and `alert-native-build-failures.yml` posts when one of its jobs
// fails. Nothing posts when the run never starts, waits for a runner for
// hours, or ends without attaching every installer, so this checks the
// releases themselves: DEADLINE_HOURS after a production release is
// published, its DMG, AppImage and their signed update archives must be on
// it.
//
// A release is checked once, by the first successful watch run after its
// deadline: each run covers the deadlines from when the previous successful
// run started (at most LOOK_BACK_HOURS ago) to when it started itself, so a late, skipped or failed run is
// made up by the next one, and a run whose post failed fails, so the next run
// posts again. The message names each release, its missing installers, the
// tag's latest `Build Desktop on Tag` run and how it ended.
//
// The step writes the message to DESKTOP_RELEASE_WATCH_MESSAGE and `post=true`
// to its outputs when there is one; the next step posts it.

import { appendFileSync, writeFileSync } from 'node:fs';

/** How long after a release is published its desktop installers must be on it. */
export const DEADLINE_HOURS = 4;

/** The furthest back a run looks for deadlines it has to check. */
export const LOOK_BACK_HOURS = 48;

/** The workflow that builds and attaches the desktop installers. */
export const DESKTOP_WORKFLOW = 'build_desktop_on_tag.yml';

const HOUR = 60 * 60 * 1000;

/** A production release's tag: `vYEAR.MONTH.DAY.REVISION`, or three-part SemVer. */
const PRODUCTION_TAG = /^v\d+\.\d+\.\d+(\.\d+)?$/;

/** The assets `Build Desktop on Tag` attaches to a release, by what they are. */
export const INSTALLERS: { label: string; name: RegExp }[] = [
  { label: 'macOS DMG', name: /^Macro-.+-aarch64-darwin\.dmg$/ },
  { label: 'macOS update archive', name: /^Macro-.+-aarch64-darwin\.app\.tar\.gz$/ },
  { label: 'macOS update signature', name: /^Macro-.+-aarch64-darwin\.app\.tar\.gz\.sig$/ },
  { label: 'Linux AppImage', name: /^Macro-.+-x86_64-linux\.AppImage$/ },
  { label: 'Linux update signature', name: /^Macro-.+-x86_64-linux\.AppImage\.sig$/ },
];

/** Job conclusions that mean the job did not finish its work. */
const RED = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure']);

export type Release = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  assets: { name: string }[];
};

export type Run = {
  id: number;
  html_url: string;
  status: string;
  conclusion: string | null;
  run_started_at?: string;
  created_at: string;
};

export type Job = { name: string; conclusion: string | null };

/** A published release that is not a prerelease, under a production tag. */
export function isProduction(release: Release): boolean {
  return (
    !release.draft && !release.prerelease && release.published_at !== null && PRODUCTION_TAG.test(release.tag_name)
  );
}

/** When the release's installers must be on it. */
export function deadline(release: Release): Date {
  return new Date(Date.parse(release.published_at ?? '') + DEADLINE_HOURS * HOUR);
}

/** The production releases whose deadline is in `(since, now]`. */
export function due(releases: Release[], since: Date, now: Date): Release[] {
  return releases.filter((release) => {
    if (!isProduction(release)) {
      return false;
    }
    const at = deadline(release).getTime();
    return at > since.getTime() && at <= now.getTime();
  });
}

/** The labels of the installers the release lacks. */
export function missingInstallers(release: Release): string[] {
  return INSTALLERS.filter(({ name }) => !release.assets.some((asset) => name.test(asset.name))).map(
    ({ label }) => label,
  );
}

/**
 * Where this run's window starts: when the previous successful run started,
 * which checked every deadline before then, but no more than LOOK_BACK_HOURS
 * ago. Without one, the last hour, the cron's interval.
 */
export function windowStart(previous: Run | undefined, now: Date): Date {
  const earliest = now.getTime() - LOOK_BACK_HOURS * HOUR;
  if (!previous) {
    return new Date(now.getTime() - HOUR);
  }
  return new Date(Math.max(earliest, Date.parse(previous.run_started_at ?? previous.created_at)));
}

/** The names of the jobs that did not finish their work. */
export function failedJobs(jobs: Job[]): string[] {
  return [...new Set(jobs.filter((job) => RED.has(job.conclusion ?? '')).map((job) => job.name))];
}

/** How a finished run's conclusion reads in the message. */
const ENDED: Record<string, string> = {
  success: 'succeeded',
  failure: 'failed',
  cancelled: 'was cancelled',
  timed_out: 'timed out',
  startup_failure: 'failed to start',
};

/** What became of the tag's latest `Build Desktop on Tag` run. */
export function describeRun(run: Run | undefined, failed: string[]): string {
  if (!run) {
    return '`Build Desktop on Tag` never ran for this tag.';
  }
  if (run.status !== 'completed') {
    return `\`Build Desktop on Tag\` is still ${run.status.replace('_', ' ')}: [run](${run.html_url}).`;
  }
  const jobs = failed.length > 0 ? ` (${failed.join(', ')})` : '';
  const ended = ENDED[run.conclusion ?? ''] ?? `ended ${run.conclusion ?? 'without a conclusion'}`;
  return `\`Build Desktop on Tag\` ${ended}${jobs}: [run](${run.html_url}).`;
}

export type Finding = { release: Release; missing: string[]; run: string };

/** The message for the releases missing installers. */
export function message(findings: Finding[]): string {
  return findings
    .map(({ release, missing, run }) => {
      const link = `[${release.tag_name}](${release.html_url})`;
      const after = `${DEADLINE_HOURS} h after it was published`;
      const what =
        missing.length === INSTALLERS.length
          ? `No desktop installers on ${link} ${after}.`
          : `Desktop installers missing from ${link} ${after}: ${missing.join(', ')}.`;
      return `🚨 ${what} ${run}`;
    })
    .join('\n\n');
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** GETs a GitHub API path, trying network and server errors three times. */
async function github(path: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const { response, body } = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env('GH_TOKEN')}`,
        'x-github-api-version': '2022-11-28',
      },
    })
      .then(async (response) => ({ response, body: await response.text() }))
      .catch((error: unknown) => ({ response: null, body: String(error) }));
    if (response?.ok) {
      try {
        return JSON.parse(body);
      } catch {
        // A body cut short: try again.
      }
    }
    const retried = response === null || response.ok || response.status >= 500 || response.status === 429;
    if (attempt === 3 || !retried) {
      throw new Error(`GET ${path}: ${response ? `HTTP ${response.status} ` : ''}${body}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
}

/** The findings for the production releases whose deadline is in `(since, now]`. */
export async function findings(repo: string, since: Date, now: Date): Promise<Finding[]> {
  // Newest first; LOOK_BACK_HOURS of releases fit in a page of 30.
  const releases: Release[] = await github(`/repos/${repo}/releases?per_page=30`);
  const found: Finding[] = [];
  for (const release of due(releases, since, now)) {
    const missing = missingInstallers(release);
    console.log(`${release.tag_name}: due ${deadline(release).toISOString()}, missing: ${missing.join(', ') || 'none'}`);
    if (missing.length === 0) {
      continue;
    }
    const query = new URLSearchParams({ branch: release.tag_name, per_page: '10' });
    const runs: Run[] = (await github(`/repos/${repo}/actions/workflows/${DESKTOP_WORKFLOW}/runs?${query}`))
      .workflow_runs;
    const run = runs[0];
    const failed =
      run?.status === 'completed'
        ? failedJobs((await github(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs)
        : [];
    found.push({ release, missing, run: describeRun(run, failed) });
  }
  return found;
}

export async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const id = Number(env('GITHUB_RUN_ID'));
  const current: Run & { workflow_id: number } = await github(`/repos/${repo}/actions/runs/${id}`);
  // Each window ends where this run started, and the next run's begins there.
  const now = new Date(Date.parse(current.run_started_at ?? current.created_at));
  const previous: Run | undefined = (
    await github(`/repos/${repo}/actions/workflows/${current.workflow_id}/runs?status=success&per_page=10`)
  ).workflow_runs.find((run: Run) => run.id !== id);
  const since = windowStart(previous, now);
  console.log(`Checking release deadlines in (${since.toISOString()}, ${now.toISOString()}]`);

  const found = await findings(repo, since, now);
  let summary: string;
  if (found.length === 0) {
    summary = 'Every production release due in this window has its desktop installers.';
    appendFileSync(env('GITHUB_OUTPUT'), 'post=false\n');
  } else {
    const text = message(found);
    writeFileSync(env('DESKTOP_RELEASE_WATCH_MESSAGE'), text);
    appendFileSync(env('GITHUB_OUTPUT'), 'post=true\n');
    summary = `Posting to Macro Alerts:\n\n${text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`;
  }
  console.log(summary);
  appendFileSync(env('GITHUB_STEP_SUMMARY'), `### Macro Alerts\n\n${summary}\n`);
}

// Tells the Macro Alerts channel when Dev stops deploying, and when it
// deploys again. `Dev Deploy Alert` runs it when a `Deploy on Push` run ends,
// and every quarter of an hour.
//
// Every push to `main` starts a `Deploy on Push` run. The runs wait for each
// other (one concurrency group), and a push that waits is replaced by the next
// one: it ends cancelled before any of its jobs started, and the run that
// replaced it deploys its commit too. Such a run is read past, never counted.
// The runs count in the order they ran, by when they ended: a run started
// again by hand runs after those created since, and deploys its older commit
// over theirs. The job lists the runs back to the last that succeeded, so it
// sees such a run when it was created on those pages.
//
// Dev is failing when one of these holds:
//
// - The newest run that ended, past the replaced ones, did not succeed: it
//   failed, ran out of time or failed to start, or it was cancelled after its
//   jobs started, by hand or by `Cancel Stuck Cloud Storage Deploys`, which
//   cancels a run CANCEL_STUCK_MINUTES after its push (DEV_DEPLOY_CANCEL_STUCK_MINUTES).
// - A job of a run still going waited RUNNER_WAIT_MINUTES for a runner, as the
//   migrations did for the in-VPC `db-migrator` runner from 2026-11-25. The
//   run counts as failing until it ends, though the job got a runner since.
//   In the three weeks before, one job waited longer, in a run cancelled
//   anyway; the next longest wait was 44 minutes.
// - The oldest commit on `main` that Dev does not run was pushed
//   UNDEPLOYED_MINUTES ago, whatever holds it: a run that never ends, a run
//   that never starts, or a push that started no run at all (the workflow is
//   disabled). In the three weeks before 2026-11-25, when no run failed in
//   between, Dev deployed each push within 121 minutes.
//
// Dev deploys again once the newest run that ended succeeded and neither of
// the other two holds. Each of the three ends only once a run ends, and the
// channel hears that Dev deploys again only from a run that deployed after it
// was told Dev is failing: a failed run re-run, going again, fails nothing yet
// but has deployed nothing either.
//
// The script posts only when that differs from what the channel was last told:
// failing while the channel shows Dev deploying posts the failure, and
// deploying while it shows Dev failing posts that it deploys again. The job
// records what the channel shows in its last step, "Macro Alerts shows Dev
// failing" or "Macro Alerts shows Dev deploying", which runs only once a post
// succeeded or none was needed, so a run of the workflow succeeds only once it
// recorded. The newest record among its recent successful runs and the
// earlier attempts of its recent runs started again by hand, read through the
// jobs API, is what the channel shows, as of when its job started, before it
// read Dev; with none, it shows Dev deploying. The workflow's runs go one at a
// time (a concurrency group), so each reads what the one before it left. A
// failed post records nothing, so the next run posts again.
//
// The step writes the message to DEV_DEPLOY_ALERT_MESSAGE, `post=true` when
// there is one, and `shows=failing` or `shows=deploying` to its outputs; the
// next steps post the message and record what the channel then shows. The
// message, or why there is none, goes to the job summary.

import { appendFileSync, writeFileSync } from 'node:fs';

/** How long a job of a run still going may wait for a runner. */
export const RUNNER_WAIT_MINUTES = 60;

/** How long after it was pushed a commit on `main` must run on Dev. */
export const UNDEPLOYED_MINUTES = 180;

/** The branch whose pushes deploy Dev. */
export const BRANCH = 'main';

/** How many deploy runs a page lists, the most it holds. */
const LISTED = 100;

/** How many pages of deploy runs the job lists at most, back to the one Dev last deployed. */
const PAGES = 10;

/** How many of the alert workflow's newest runs, and of its newest successful ones, the job reads for a record. */
export const LOOK_BACK = 30;

/** How many runs' jobs the job reads at once. */
const BATCH = 5;

/** How many jobs a line names before it counts the rest. */
const NAMED = 6;

/** Where the alert sends a reader. */
export const WHAT_TO_DO = 'docs/development/infrastructure.md#when-a-dev-deploy-alert-fires';

/** Conclusions of a finished job that mean it did not do its work. */
const RED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Statuses of a run whose jobs have started; any other unfinished run is still waiting its turn. */
const STARTED = new Set(['queued', 'in_progress']);

/** Statuses of an unfinished job that has a runner. */
const RUNNING = new Set(['in_progress']);

const MINUTE = 60 * 1000;

/** A run, as the runs API lists it. */
export type Run = {
  id: number;
  run_number: number;
  /** Its latest attempt: above 1 once started again by hand. */
  run_attempt?: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  /** When it was last changed: for a run that ended, when it ended. */
  updated_at: string;
  head_sha: string;
  html_url: string;
  head_commit?: { message?: string } | null;
};

export type Step = { name: string; conclusion: string | null; completed_at?: string | null };

/** A job of a run, as the jobs API lists it. */
export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  labels?: string[];
  steps?: Step[];
};

/** A pushed commit: its SHA and the first line of its message. */
export type Push = { sha: string; title: string };

/** The oldest commit on the branch that Dev does not run. */
export type Undeployed = Push & {
  /** When it was pushed: its run's creation, or the commit's date when no run started for it. */
  at: string;
  /** Whether a deploy run started for the branch's newest commit. */
  headHasRun: boolean;
};

/** A job that failed, with the first step that failed; null when it has none, or none failed. */
export type FailedJob = { name: string; step: string | null };

/**
 * A job that waited for a runner: for how long, with what labels, and whether
 * it got one in the end.
 */
export type Waited = { name: string; labels: string[]; minutes: number; started: boolean };

/** One reason Dev is failing. */
export type Problem =
  | { kind: 'failed'; run: Run; jobs: FailedJob[] }
  | { kind: 'cancelled'; run: Run; waiting: Waited[]; running: FailedJob[] }
  | { kind: 'waiting'; run: Run; job: Waited }
  | { kind: 'undeployed'; since: Undeployed; minutes: number; deploying: Run | null };

/** What Dev's deploys show: why it is failing, if it is, and what it last deployed. */
export type Health = { problems: Problem[]; deployed: Run | null };

/** What the channel shows, from the newest record. */
export type Shown = { failing: boolean; at: string | null };

/** Whether to post, and what the channel shows once the job is done (`failing`). */
export type Decision = { post: 'failure' | 'recovery' | null; failing: boolean; why: string };

/** The names of the alert job and of the steps the script reads. */
export type Names = {
  job: string;
  /** The step that records that the channel shows Dev failing. */
  failing: string;
  /** The step that records that the channel shows Dev deploying. */
  deploying: string;
};

/** What the message links to. */
export type Context = {
  /** `https://github.com/<owner>/<repo>`. */
  repoUrl: string;
  /** The deploy workflow's file, for its runs page. */
  workflow: string;
  /** How old `Cancel Stuck Cloud Storage Deploys` lets a run get, in minutes. */
  cancelStuckMinutes: number;
  now: number;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const time = (at: string | number) => (typeof at === 'number' ? at : Date.parse(at));

const minutesBetween = (from: string | number, to: string | number) => (time(to) - time(from)) / MINUTE;

const sinceMinutes = (at: string, now: number) => minutesBetween(at, now);

/** When a run ended; a run still going ends after every run that has. */
const endOf = (run: Run) => (run.status === 'completed' ? time(run.updated_at) : Infinity);

/**
 * The run that ended last first, after those still going. Runs go one at a
 * time, so that is the order they ran in, also for a run started again by
 * hand, which deploys its older commit over the newer ones.
 */
const newestFirst = (a: Run, b: Run) => endOf(b) - endOf(a) || b.run_number - a.run_number;

/** Whether `run` ran after `than`, or there is no `than`. */
const ranAfter = (run: Run, than: Run | null) => than === null || newestFirst(run, than) < 0;

/** The run that deployed last: `deployed`, or one in `runs` that succeeded after it. */
export function lastDeployed(deployed: Run | null, runs: Run[]): Run | null {
  return (
    [deployed, ...runs.filter((run) => run.status === 'completed' && run.conclusion === 'success')]
      .filter((run): run is Run => run !== null)
      .sort(newestFirst)[0] ?? null
  );
}

/** The latest attempt of each of a run's jobs, in the order the run started them. */
export function latestAttempts(jobs: Job[]): Job[] {
  const latest = new Map<string, Job>();
  for (const job of jobs) {
    const seen = latest.get(job.name);
    if (!seen || (job.run_attempt ?? 1) > (seen.run_attempt ?? 1)) {
      latest.set(job.name, job);
    }
  }
  return [...latest.values()].sort((a, b) => a.id - b.id);
}

const failedStep = (job: Job, conclusions: Set<string>) =>
  job.steps?.find((step) => conclusions.has(step.conclusion ?? ''))?.name ?? null;

/**
 * Why a run that ended without success failed: the jobs that failed or ran out
 * of time; for one cancelled after its jobs started, the jobs still waiting for
 * a runner and those cancelled while they ran. A job that waited under a
 * minute, such as a matrix the cancel stopped before it expanded, is left out.
 */
export function endedProblem(run: Run, jobs: Job[]): Problem {
  const latest = latestAttempts(jobs);
  if (run.conclusion !== 'cancelled') {
    const failed = latest.filter((job) => RED.has(job.conclusion ?? ''));
    return {
      kind: 'failed',
      run,
      jobs: (failed.length > 0 ? failed : latest.filter((job) => job.conclusion === 'cancelled')).map((job) => ({
        name: job.name,
        step: failedStep(job, new Set([...RED, 'cancelled'])),
      })),
    };
  }
  const cancelled = latest.filter((job) => job.conclusion === 'cancelled');
  const ran = (job: Job) => Boolean(job.runner_name) && (job.steps?.length ?? 0) > 0;
  return {
    kind: 'cancelled',
    run,
    waiting: cancelled
      .filter((job) => !ran(job))
      .map((job) => ({
        name: job.name,
        labels: job.labels ?? [],
        minutes: minutesBetween(job.created_at, job.completed_at ?? run.updated_at),
        started: false,
      }))
      .filter((job) => job.minutes >= 1)
      .sort((a, b) => b.minutes - a.minutes),
    running: cancelled.filter(ran).map((job) => ({ name: job.name, step: failedStep(job, new Set(['cancelled'])) })),
  };
}

/**
 * The job of a run still going that waited longest for a runner: one waiting
 * still, or one that waited before it started.
 */
export function longestWait(jobs: Job[], now: number): Waited | null {
  const waits = latestAttempts(jobs).flatMap((job): Waited[] => {
    const labels = job.labels ?? [];
    if (job.status !== 'completed' && !RUNNING.has(job.status)) {
      return [{ name: job.name, labels, minutes: sinceMinutes(job.created_at, now), started: false }];
    }
    return job.runner_name && job.started_at
      ? [{ name: job.name, labels, minutes: minutesBetween(job.created_at, job.started_at), started: true }]
      : [];
  });
  // The one waiting still, of two that waited as long.
  return waits.sort((a, b) => b.minutes - a.minutes || Number(a.started) - Number(b.started))[0] ?? null;
}

/**
 * Why Dev is failing, if it is, from the deploy runs newer than the one Dev
 * last deployed (`deployed`, the newest that succeeded) and the oldest commit
 * Dev does not run. `runs` may hold older runs, and runs in any order. Reads
 * the jobs of a run with `jobsOf`, a few runs at a time, newest first, until
 * the newest run that ended past the replaced ones.
 */
export async function assess({
  runs,
  deployed,
  undeployed,
  now,
  jobsOf,
}: {
  runs: Run[];
  deployed: Run | null;
  undeployed: Undeployed | null;
  now: number;
  jobsOf: (run: Run) => Promise<Job[]>;
}): Promise<Health> {
  // The list can be newer than the query for the last success.
  const last = lastDeployed(deployed, runs);
  const newer = runs.filter((run) => ranAfter(run, last)).sort(newestFirst);
  const needsJobs = (run: Run) => run.status === 'completed' || STARTED.has(run.status);

  const problems: Problem[] = [];
  let ended: Problem | null = null;
  let deploying: Run | null = null;
  for (let start = 0; start < newer.length && ended === null; start += BATCH) {
    const batch = newer.slice(start, start + BATCH);
    const jobs = await Promise.all(batch.map((run) => (needsJobs(run) ? jobsOf(run) : Promise.resolve([]))));
    for (const [index, run] of batch.entries()) {
      if (run.status === 'completed') {
        if (run.conclusion === 'cancelled' && jobs[index].length === 0) {
          // Replaced while it waited.
          continue;
        }
        ended = endedProblem(run, jobs[index]);
        break;
      }
      if (STARTED.has(run.status)) {
        deploying ??= run;
        const waited = longestWait(jobs[index], now);
        if (waited && waited.minutes >= RUNNER_WAIT_MINUTES) {
          problems.push({ kind: 'waiting', run, job: waited });
        }
      }
    }
  }
  if (ended) {
    problems.unshift(ended);
  }
  if (undeployed) {
    const minutes = sinceMinutes(undeployed.at, now);
    if (minutes >= UNDEPLOYED_MINUTES) {
      problems.push({ kind: 'undeployed', since: undeployed, minutes, deploying });
    }
  }
  return { problems, deployed: last };
}

/** What each alert job of a run, in any attempt, recorded, as of when the job started. */
export function records(jobs: Job[], names: Names): { failing: boolean; at: string }[] {
  const done = (job: Job, name: string) =>
    job.steps?.find((step) => step.name === name && step.conclusion === 'success');
  return jobs.flatMap((job) => {
    const shown = job.name === names.job ? (done(job, names.failing) ?? done(job, names.deploying)) : undefined;
    return shown && job.started_at ? [{ failing: shown.name === names.failing, at: job.started_at }] : [];
  });
}

/**
 * What the channel shows, from the newest record among the alert workflow's
 * `runs`, read a few at a time with `jobsOf`, the one that ran last first,
 * until one holds a record; with none, Dev deploying.
 */
export async function readShown(
  runs: Run[],
  names: Names,
  jobsOf: (run: Run) => Promise<Job[]>,
): Promise<Shown> {
  const sorted = [...runs].sort(newestFirst).slice(0, LOOK_BACK);
  for (let start = 0; start < sorted.length; start += BATCH) {
    const batch = sorted.slice(start, start + BATCH);
    const found = (await Promise.all(batch.map(jobsOf)))
      .flatMap((jobs) => records(jobs, names))
      .sort((a, b) => b.at.localeCompare(a.at));
    if (found.length > 0) {
      return found[0];
    }
  }
  return { failing: false, at: null };
}

/** Whether the job posts, from Dev's health and what the channel shows. */
export function decide(health: Health, shown: Shown): Decision {
  const failing = health.problems.length > 0;
  const as = shown.at ? ` (since ${shown.at})` : '';
  if (failing && !shown.failing) {
    return { post: 'failure', failing, why: 'Dev is failing' };
  }
  if (!failing && shown.failing) {
    const deployedSince =
      health.deployed !== null && shown.at !== null && time(health.deployed.updated_at) > time(shown.at);
    return deployedSince
      ? { post: 'recovery', failing, why: 'Dev deploys again' }
      : {
          post: null,
          failing: true,
          why: `no run fails now, but Dev has deployed nothing since the channel was told it is failing${as}`,
        };
  }
  return {
    post: null,
    failing,
    why: failing
      ? `Dev is failing (${health.problems.map((problem) => problem.kind).join(', ')}), and the channel already shows it failing${as}`
      : shown.at
        ? `Dev deploys, and the channel already shows it deploying${as}`
        : 'Dev deploys, and the channel was never told otherwise',
  };
}

const short = (sha: string) => sha.slice(0, 7);

/** A code span; a name holds no backtick, but one would end the span early. */
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

/** Text the channel would otherwise read as a tag. */
const plain = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');

/** A span of minutes as `45 min`, `2 h 5 min` or `2 d 3 h`. */
export function duration(minutes: number): string {
  const whole = Math.max(0, Math.floor(minutes));
  if (whole < 60) {
    return `${whole} min`;
  }
  const hours = Math.floor(whole / 60);
  if (hours < 24) {
    return whole % 60 === 0 ? `${hours} h` : `${hours} h ${whole % 60} min`;
  }
  return hours % 24 === 0 ? `${Math.floor(hours / 24)} d` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

const title = (run: Run) => String(run.head_commit?.message ?? '').split('\n')[0];

const pushOf = (run: Run): Push => ({ sha: run.head_sha, title: title(run) });

/** The push of a commit, with its pull request. */
export function describePush(push: Push, repoUrl: string): string {
  const pr = /\(#(\d+)\)$/.exec(push.title)?.[1];
  const text = `${code(short(push.sha))} ${plain(push.title.replace(/\s*\(#\d+\)$/, ''))}`.trimEnd();
  return pr ? `push of ${text} ([#${pr}](${repoUrl}/pull/${pr}))` : `push of ${text}`;
}

const names = (items: string[]) => {
  const shown = items.slice(0, NAMED).map(code).join(', ');
  return items.length > NAMED ? `${shown} and ${items.length - NAMED} more` : shown;
};

/** Jobs, with those stopped at the same step together. */
export function jobsLine(jobs: FailedJob[]): string {
  const byStep = new Map<string | null, string[]>();
  for (const job of jobs) {
    byStep.set(job.step, [...(byStep.get(job.step) ?? []), job.name]);
  }
  return [...byStep]
    .map(([step, jobs]) => (step ? `${names(jobs)} at “${step}”` : names(jobs)))
    .join('; ');
}

const waitedLine = (job: Waited) =>
  `${code(job.name)} waited ${duration(job.minutes)} for a runner${job.labels.length > 0 ? ` labelled ${job.labels.map(code).join(', ')}` : ''}`;

const runLink = (run: Run) => `[run #${run.run_number}](${run.html_url})`;

function headline(problem: Problem, context: Context): string {
  switch (problem.kind) {
    case 'failed':
      return `🚨 · **Dev deploy failed** · ${describePush(pushOf(problem.run), context.repoUrl)}`;
    case 'cancelled':
      return `🚨 · **Dev deploy was cancelled** · ${describePush(pushOf(problem.run), context.repoUrl)}`;
    case 'waiting':
      return problem.job.started
        ? `🚨 · **Dev deploy was held up waiting for a runner** · ${describePush(pushOf(problem.run), context.repoUrl)}`
        : `🚨 · **Dev deploy is stuck waiting for a runner** · ${describePush(pushOf(problem.run), context.repoUrl)}`;
    case 'undeployed':
      return `🚨 · **Dev has not deployed for ${duration(problem.minutes)}** · since the ${describePush(problem.since, context.repoUrl)}`;
  }
}

function details(problem: Problem, context: Context, first: boolean): string[] {
  switch (problem.kind) {
    case 'failed':
      return problem.jobs.length > 0
        ? [`Failed jobs: ${jobsLine(problem.jobs)}`]
        : [`The run ended ${code(problem.run.conclusion ?? 'unfinished')} before any job failed.`];
    case 'cancelled': {
      const age = minutesBetween(problem.run.created_at, problem.run.updated_at);
      const why =
        age >= context.cancelStuckMinutes
          ? `, past the ${context.cancelStuckMinutes} min after which \`Cancel Stuck Cloud Storage Deploys\` cancels a deploy`
          : '';
      return [
        `Cancelled ${duration(age)} after the push${why}.`,
        ...(problem.waiting.length > 0 ? [`Still waiting then: ${problem.waiting.slice(0, NAMED).map(waitedLine).join('; ')}.`] : []),
        ...(problem.running.length > 0 ? [`Cancelled while running: ${jobsLine(problem.running)}.`] : []),
      ];
    }
    case 'waiting': {
      const line = waitedLine(problem.job);
      return [
        `${first ? '' : `In ${runLink(problem.run)}, `}${problem.job.started ? `${line}, and has run since` : line.replace(' waited ', ' has waited ')}.`,
      ];
    }
    case 'undeployed':
      return [
        ...(problem.since.headHasRun
          ? []
          : [`No ${code('Deploy on Push')} run started for the newest push: check that the workflow is enabled.`]),
        ...(first && problem.deploying
          ? [`${runLink(problem.deploying)}, of ${code(short(problem.deploying.head_sha))}, has been going for ${duration(minutesBetween(problem.deploying.created_at, context.now))}.`]
          : []),
      ];
  }
}

const runOf = (problem: Problem) =>
  problem.kind === 'undeployed' ? problem.deploying : problem.run;

/** The message when Dev turns failing. */
export function failureMessage(health: Health, context: Context): string {
  const [first, ...rest] = health.problems;
  const lines = [headline(first, context), ...details(first, context, true)];
  for (const problem of rest) {
    lines.push(...details(problem, context, false));
  }
  const { deployed } = health;
  const head = runOf(first)?.head_sha;
  lines.push(
    deployed
      ? `Dev last deployed ${code(short(deployed.head_sha))} ${duration(sinceMinutes(deployed.updated_at, context.now))} ago${head && head !== deployed.head_sha ? ` · [changes since](${context.repoUrl}/compare/${deployed.head_sha}...${head})` : ''}`
      : 'No run of the last ones listed deployed Dev.',
  );
  const run = runOf(first);
  lines.push(
    `${run ? `[Run](${run.html_url})` : `[Runs](${context.repoUrl}/actions/workflows/${context.workflow})`} · [What to do](${context.repoUrl}/blob/main/${WHAT_TO_DO})`,
  );
  return lines.join('\n');
}

/** The message when Dev deploys again, after `previous`, the deploy before. */
export function recoveryMessage(deployed: Run, previous: Run | null, context: Context): string {
  const before = previous
    ? `Dev had last deployed ${code(short(previous.head_sha))} ${duration(minutesBetween(previous.updated_at, deployed.updated_at))} before. `
    : '';
  return [
    `✅ Resolved · **Dev deploys again** · ${describePush(pushOf(deployed), context.repoUrl)}`,
    `${before}[Run](${deployed.html_url})`,
  ].join('\n');
}

/**
 * GETs a GitHub API path. Network errors, server errors and rate limits are
 * tried three times, waiting as long as GitHub asks when that fits in the job.
 */
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
    const limited = response?.status === 429 || (response?.status === 403 && /rate limit/i.test(body));
    const retried = response === null || response.ok || response.status >= 500 || limited;
    if (attempt === 3 || !retried) {
      throw new Error(`GET ${path}: ${response ? `HTTP ${response.status} ` : ''}${body}`);
    }
    const retryAfter = Number(response?.headers.get('retry-after'));
    const reset = Number(response?.headers.get('x-ratelimit-reset')) - Date.now() / 1000;
    const exhausted = response?.headers.get('x-ratelimit-remaining') === '0';
    const seconds = retryAfter > 0 ? retryAfter : !limited ? 5 * attempt : exhausted && reset > 0 ? reset : 60;
    // The job's own time limit is ten minutes; a longer wait would not end in time.
    if (seconds > 120) {
      throw new Error(`GET ${path}: rate limited for ${Math.round(seconds)}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}

/** Every job of a run, in every attempt, page by page. */
async function jobsOf(repo: string, run: number): Promise<Job[]> {
  const jobs: Job[] = [];
  for (let page = 1; ; page++) {
    const listed = await github(`/repos/${repo}/actions/runs/${run}/jobs?filter=all&per_page=100&page=${page}`);
    jobs.push(...listed.jobs);
    if (listed.jobs.length < 100 || jobs.length >= listed.total_count) {
      return jobs;
    }
  }
}

/**
 * The oldest commit on the branch that Dev does not run: the oldest push since
 * `deployed` that started a run, or, when the branch's newest commit started
 * none, the oldest commit since `deployed` by its date.
 */
async function findUndeployed(repo: string, runs: Run[], deployed: Run | null): Promise<Undeployed | null> {
  const head = (await github(`/repos/${repo}/branches/${BRANCH}`)).commit;
  if (deployed?.head_sha === head.sha) {
    return null;
  }
  // The pushes after the one Dev runs, oldest last.
  const since = runs
    .filter((run) => deployed === null || run.run_number > deployed.run_number)
    .sort((a, b) => b.run_number - a.run_number);
  const oldest = since.at(-1);
  if (since.some((run) => run.head_sha === head.sha) && oldest) {
    return { ...pushOf(oldest), at: oldest.created_at, headHasRun: true };
  }
  const first = deployed
    ? (await github(`/repos/${repo}/compare/${deployed.head_sha}...${head.sha}?per_page=1`)).commits[0]
    : head;
  const commit = first ?? head;
  const pushed = { sha: commit.sha, title: String(commit.commit.message).split('\n')[0], at: commit.commit.committer.date };
  const older = oldest && Date.parse(oldest.created_at) < Date.parse(pushed.at) ? { ...pushOf(oldest), at: oldest.created_at } : pushed;
  return { ...older, headHasRun: false };
}

export async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const workflow = env('DEV_DEPLOY_WORKFLOW');
  const names: Names = {
    job: env('DEV_DEPLOY_ALERT_JOB'),
    failing: env('DEV_DEPLOY_ALERT_FAILING_STEP'),
    deploying: env('DEV_DEPLOY_ALERT_DEPLOYING_STEP'),
  };
  const context: Context = {
    repoUrl: `${env('GITHUB_SERVER_URL')}/${repo}`,
    workflow,
    cancelStuckMinutes: Number(env('DEV_DEPLOY_CANCEL_STUCK_MINUTES')),
    now: Date.now(),
  };
  const runsOf = async (query: Record<string, string>) =>
    (
      await github(
        `/repos/${repo}/actions/workflows/${workflow}/runs?${new URLSearchParams({ branch: BRANCH, event: 'push', ...query })}`,
      )
    ).workflow_runs as Run[];

  const own = await github(`/repos/${repo}/actions/runs/${env('GITHUB_RUN_ID')}`);
  const alertRunsOf = async (query: Record<string, string>) =>
    (await github(`/repos/${repo}/actions/workflows/${own.workflow_id}/runs?${new URLSearchParams({ branch: BRANCH, ...query })}`))
      .workflow_runs as Run[];
  const [[queried = null, previous = null], recorded, latest] = await Promise.all([
    runsOf({ status: 'success', per_page: '2' }),
    alertRunsOf({ status: 'success', per_page: `${LOOK_BACK}` }),
    alertRunsOf({ per_page: `${LOOK_BACK}` }),
  ]);
  // Listed after that query, back to the run it found, so the list holds every
  // run since; a run that succeeded in between is the one Dev deployed.
  const byId = new Map<number, Run>();
  for (let page = 1; page <= PAGES; page++) {
    const listed = await runsOf({ per_page: `${LISTED}`, page: `${page}` });
    for (const run of listed) {
      byId.set(run.id, run);
    }
    if (listed.length < LISTED || (queried !== null && listed.some((run) => run.run_number <= queried.run_number))) {
      break;
    }
  }
  const runs = [...byId.values()];
  const deployed = lastDeployed(queried, runs);
  const read = (run: Run) => jobsOf(repo, run.id);
  const health = await assess({
    runs,
    deployed,
    undeployed: await findUndeployed(repo, runs, deployed),
    now: context.now,
    jobsOf: read,
  });
  // A run started again by hand, this one or one that then failed, holds what
  // its earlier attempts recorded.
  const startedAgain = latest.filter((run) => (run.run_attempt ?? 1) > 1);
  const alertRuns = [...new Map([own, ...startedAgain, ...recorded].map((run) => [run.id, run])).values()];
  const shown = await readShown(alertRuns, names, read);
  const decision = decide(health, shown);

  const outputs = [`shows=${decision.failing ? 'failing' : 'deploying'}`];
  let summary: string;
  if (decision.post === null) {
    summary = `Nothing posted to Macro Alerts: ${decision.why}.`;
    outputs.push('post=false');
  } else {
    // A recovery follows a deploy, the newest success the query found or one
    // the list found after it, whose deploy before is that query's.
    const message =
      decision.post === 'recovery' && deployed
        ? recoveryMessage(deployed, deployed.id === queried?.id ? previous : queried, context)
        : failureMessage(health, context);
    writeFileSync(env('DEV_DEPLOY_ALERT_MESSAGE'), message);
    outputs.push('post=true');
    summary = `Posting to Macro Alerts:\n\n${message
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`;
  }
  appendFileSync(env('GITHUB_OUTPUT'), `${outputs.join('\n')}\n`);
  console.log(summary);
  appendFileSync(env('GITHUB_STEP_SUMMARY'), `### Macro Alerts\n\n${summary}\n`);
}

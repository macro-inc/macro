// Tells the Macro Alerts channel when an email end-to-end workflow turns red
// on `main`, and when it turns green again. The last job of `email_e2e.yml`,
// `email_e2e_browser.yml` and `email_e2e_full_stack.yml` runs it after every
// other job, on a push to `main` and in the daily sweep; never on a run by
// hand.
//
// A run posts at most one message, and only when it changes the state of its
// stream: the workflow's runs on the same branch for the same event (the
// pushes, or the sweep). The first red run after a green one posts the
// failure; the first green run after a red one posts that it passes again. A
// red run after a red one posts nothing, since one broken test fails every run
// after it until it is fixed. Pushes and the sweep are apart because only the
// sweep runs the tests kept for known bugs: one of those that passes would
// otherwise turn the stream red at every sweep and green at the next push.
//
// Runs of different commits run side by side, so the order is the order in
// which their jobs ended, and every run's alert job reaches the same answer
// whenever it runs. A run ends when every job but this one has; it is red when
// one of them failed, timed out or was cancelled (its time ran out), and a run
// that was cancelled does not count. A run counts only when no newer run ended
// before it: a result that arrives after a newer one is not the branch's
// latest, so it posts nothing and later runs pass it over. A re-run is compared
// with its own earlier attempts. This job's own result is left out, so that a
// failed post does not turn the stream red.
//
// A failure names the commit, each failed job with the step it failed at, and
// what the run's coverage report (downloaded to EMAIL_E2E_REPORTS) says
// failed: gating tests, tests kept for known bugs that now pass, or the
// coverage check itself. The step writes the message to
// EMAIL_E2E_ALERT_MESSAGE and `post=true` to its outputs, and the next step
// posts it. The message, or why there is none, goes to the job summary.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Conclusions of a finished job that mean it failed. */
const RED = new Set(['failure', 'timed_out', 'cancelled']);

/** Statuses of a run whose jobs have not started. */
const NOT_STARTED = new Set(['queued', 'waiting', 'pending', 'requested']);

/** How many runs before this one a decision looks at, at most. */
const LOOK_BACK = 15;

/** How many failed tests a message names before it counts the rest. */
const NAMED = 8;

/** Where the alert sends a reader. */
export const WHAT_TO_DO = 'docs/development/ci.md#when-an-email-end-to-end-alert-fires';

/** A line of the browser suite's coverage check about a test kept for a known bug. */
const KNOWN_BUG_PASSES = 'a test kept for a known bug passes: remove its @known-bug tag and its waiver: ';

/** The Rust suite's coverage gap for a scenario kept for a known bug that passes. */
const KNOWN_BUG_SCENARIO = /^scenario `(.+)`, kept for a known bug, passes/;

/** The Rust suite's coverage gap for a scenario that failed. */
const FAILED_SCENARIO = /^scenario `.+` failed$/;

/** A run of the workflow, as the runs API lists it. */
export type StreamRun = {
  id: number;
  run_number: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
};

/** A job of a run, as the jobs API lists it. */
export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
  steps?: { name: string; conclusion: string | null }[];
};

export type FailedJob = { name: string; step: string | null };

/** Where a run stands, judged by its jobs other than this one. */
export type Outcome =
  | { ended: false; why: 'running' | 'cancelled' }
  | { ended: true; red: boolean; endedAt: string };

/** A run, or an earlier attempt of this one, that counts in the stream. */
export type Point = { id: number; run_number: number; head_sha: string; red: boolean };

export type Decision =
  | { post: 'failure'; lastGreen: Point | null }
  | { post: 'recovery'; failingSince: Point; redRuns: number; atLeast: boolean }
  | { post: null; why: string };

/** What the run's coverage report says failed. */
export type Findings = {
  /** Gating tests that failed. */
  failedTests: string[];
  /** Tests kept for known bugs that passed: the known-bug report, not a gating test. */
  knownBugsPassing: string[];
  /** Everything else the coverage check fails on. */
  otherProblems: string[];
};

/** What the message says about the run. */
export type Context = {
  runId: number;
  workflow: string;
  event: string;
  branch: string;
  sha: string;
  /** The first line of the head commit's message. */
  title: string;
  /** `https://github.com/<owner>/<repo>`. */
  repoUrl: string;
  runUrl: string;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * The jobs that failed, each with the first step that failed, in the order the
 * run started them: the suite's before the coverage job that reads their
 * results. A cancelled job counts: this job runs only in a run that was not
 * cancelled, so such a job ran out of time. Jobs still running, this one among
 * them, are left out.
 */
export function failedJobs(jobs: Job[]): FailedJob[] {
  const failed = (conclusion: string | null) => RED.has(conclusion ?? '');
  return jobs
    .filter((job) => job.status === 'completed' && failed(job.conclusion))
    .sort((a, b) => a.id - b.id)
    .map((job) => ({
      name: job.name,
      step: job.steps?.find((step) => failed(step.conclusion))?.name ?? null,
    }));
}

/**
 * Where a run stands, from its jobs other than `alertJob`. A job of it that was
 * cancelled means its time ran out when its alert job ran, which happens only
 * in a run that was not cancelled; otherwise the run was cancelled, or is
 * being, and does not count.
 */
export function outcome(run: StreamRun, jobs: Job[], alertJob: string): Outcome {
  const suite = jobs.filter((job) => job.name !== alertJob);
  const alert = jobs.find((job) => job.name === alertJob);
  const unsettled: Outcome = { ended: false, why: run.status === 'completed' ? 'cancelled' : 'running' };
  if (suite.length === 0 || suite.some((job) => job.status !== 'completed')) {
    return unsettled;
  }
  const alertRan =
    alert?.status === 'in_progress' ||
    (alert?.status === 'completed' && (alert.conclusion === 'success' || alert.conclusion === 'failure'));
  if (suite.some((job) => job.conclusion === 'cancelled') && !alertRan) {
    return unsettled;
  }
  return {
    ended: true,
    red: failedJobs(suite).length > 0,
    endedAt: suite.map((job) => job.completed_at ?? '').sort().at(-1) ?? '',
  };
}

const short = (sha: string) => sha.slice(0, 7);

const point = (run: StreamRun, red: boolean): Point => ({
  id: run.id,
  run_number: run.run_number,
  head_sha: run.head_sha,
  red,
});

/**
 * Whether this run posts, from its result and the stream around it.
 * `attempts` are the outcomes of this run's earlier attempts, newest first;
 * `stream` the workflow's other runs of the branch and event; `outcomes` what
 * is known of them. When it needs a run's outcome it does not have, it asks
 * for that run, and is called again once the outcome is known.
 */
export function decide({
  run,
  result,
  attempts,
  stream,
  outcomes,
}: {
  run: StreamRun;
  result: { red: boolean; endedAt: string };
  attempts: Outcome[];
  stream: StreamRun[];
  outcomes: Map<number, Outcome>;
}): Decision | { need: StreamRun } {
  const known = (each: StreamRun): Outcome | undefined =>
    outcomes.get(each.id) ?? (NOT_STARTED.has(each.status) ? { ended: false, why: 'running' } : undefined);
  const others = stream
    .filter((each) => each.id !== run.id)
    .sort((a, b) => b.run_number - a.run_number);

  for (const each of others.filter((other) => other.run_number > run.run_number)) {
    const other = known(each);
    if (other === undefined) {
      return { need: each };
    }
    if (other.ended && other.endedAt < result.endedAt) {
      return {
        post: null,
        why: `run #${each.run_number}, which is newer, ended first, so this result is not the branch's latest`,
      };
    }
  }

  // The points before this one, newest first: its earlier attempts, then the
  // older runs that count, found as they are needed.
  const ended = attempts.filter((attempt) => attempt.ended);
  const points: Point[] = ended.map((attempt) => point(run, attempt.red));
  const older = others.filter((other) => other.run_number < run.run_number);
  let next = 0;
  let firstEnd = ended.at(-1)?.endedAt ?? result.endedAt;
  let cutShort = false;
  const pointAt = (index: number): Point | null | { need: StreamRun } => {
    while (points.length <= index) {
      if (next >= older.length) {
        return null;
      }
      if (next >= LOOK_BACK) {
        cutShort = true;
        return null;
      }
      const each = older[next];
      const other = known(each);
      if (other === undefined) {
        return { need: each };
      }
      next++;
      // One still running ends after this run, so it will not count.
      if (other.ended) {
        if (other.endedAt < firstEnd) {
          points.push(point(each, other.red));
          firstEnd = other.endedAt;
        }
      }
    }
    return points[index];
  };

  const previous = pointAt(0);
  if (previous !== null && 'need' in previous) {
    return previous;
  }
  const label =
    previous === null
      ? 'no run before it ended'
      : previous.id === run.id
        ? 'its previous attempt'
        : `run #${previous.run_number} (at ${short(previous.head_sha)})`;
  if (result.red) {
    return previous?.red
      ? { post: null, why: `${label} failed too, and only the first red run of a streak posts` }
      : { post: 'failure', lastGreen: previous };
  }
  if (!previous?.red) {
    return { post: null, why: previous ? `it passed, as ${label} did` : `it passed, and ${label}` };
  }
  let last = 0;
  for (;;) {
    const before = pointAt(last + 1);
    if (before !== null && 'need' in before) {
      return before;
    }
    if (before === null || !before.red) {
      break;
    }
    last++;
  }
  const streak = points.slice(0, last + 1);
  return {
    post: 'recovery',
    failingSince: streak[last],
    // A run that failed in two attempts is one run.
    redRuns: new Set(streak.map((point) => point.id)).size,
    atLeast: cutShort && points.length === last + 1,
  };
}

type PlaywrightSpec = { title: string; file: string; line: number; tests: { status: string }[] };
type PlaywrightSuite = { specs?: PlaywrightSpec[]; suites?: PlaywrightSuite[] };

/** `file:line title` of each spec that failed in a Playwright JSON report. */
export function failedSpecs(report: { suites?: PlaywrightSuite[] }): string[] {
  const walk = (suites: PlaywrightSuite[] = []): string[] =>
    suites.flatMap((suite) => [
      ...(suite.specs ?? [])
        .filter((spec) => spec.tests.some((test) => test.status === 'unexpected'))
        .map((spec) => `${spec.file}:${spec.line} ${spec.title}`),
      ...walk(suite.suites),
    ]);
  return walk(report.suites);
}

/** What the Rust suite's `coverage.json` says failed. */
export function rustFindings(coverage: {
  suite: { failed: string[] };
  broken: string[];
  gaps: string[];
}): Findings {
  const knownBugsPassing = coverage.gaps.flatMap((gap) => KNOWN_BUG_SCENARIO.exec(gap)?.[1] ?? []);
  return {
    failedTests: coverage.suite.failed,
    knownBugsPassing,
    otherProblems: [
      ...coverage.broken,
      ...coverage.gaps.filter((gap) => !FAILED_SCENARIO.test(gap) && !KNOWN_BUG_SCENARIO.test(gap)),
    ],
  };
}

/**
 * What the browser suite's `ledger.json` and the Playwright reports beside it
 * (`playwright-<run>[-<shard>].json`) say failed.
 */
export function browserFindings(
  ledger: { failures: string[] },
  reports: { name: string; report: { suites?: PlaywrightSuite[] } }[],
): Findings {
  const gating = reports.filter(({ name }) => /^playwright-(gating|full-stack)(-\d+)?\.json$/.test(name));
  return {
    // A test that ran on both stacks failed once for each.
    failedTests: [...new Set(gating.flatMap(({ report }) => failedSpecs(report)))],
    knownBugsPassing: ledger.failures
      .filter((line) => line.startsWith(KNOWN_BUG_PASSES))
      .map((line) => line.slice(KNOWN_BUG_PASSES.length)),
    otherProblems: ledger.failures.filter((line) => !line.startsWith(KNOWN_BUG_PASSES)),
  };
}

/** What the coverage report in `dir` says failed, or null when there is none. */
export function readFindings(dir: string): Findings | null {
  const read = (name: string) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
  if (existsSync(`${dir}/coverage.json`)) {
    return rustFindings(read('coverage.json'));
  }
  if (existsSync(`${dir}/ledger.json`)) {
    const reports = readdirSync(dir)
      .filter((name) => /^playwright-.*\.json$/.test(name))
      .map((name) => ({ name, report: read(name) }));
    return browserFindings(read('ledger.json'), reports);
  }
  return null;
}

/** A code span; a name holds no backtick, but one would end the span early. */
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

/** Text the channel would otherwise read as a tag. */
const plain = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');

function names(items: string[]): string {
  const shown = items.slice(0, NAMED).map(code).join(', ');
  return items.length > NAMED ? `${shown} and ${items.length - NAMED} more` : shown;
}

/**
 * The failed jobs, by the part of their name after the workflow's ("1/3",
 * "coverage"), with those that failed at the same step together.
 */
export function jobsLine(workflow: string, jobs: FailedJob[]): string {
  const part = (name: string) =>
    name.startsWith(`${workflow} `) ? name.slice(workflow.length + 1).replace(/^\((.*)\)$/, '$1') : name;
  const byStep = new Map<string | null, string[]>();
  for (const job of jobs) {
    byStep.set(job.step, [...(byStep.get(job.step) ?? []), part(job.name)]);
  }
  return [...byStep]
    .map(([step, parts]) => (step ? `${parts.join(', ')} at “${step}”` : parts.join(', ')))
    .join('; ');
}

/** Which run: the push of a commit, with its PR, or the sweep at a commit. */
function which(context: Context): string {
  const pr = /\(#(\d+)\)$/.exec(context.title)?.[1];
  const title = plain(context.title.replace(/\s*\(#\d+\)$/, ''));
  const commit = `${code(short(context.sha))} ${title}`;
  if (context.event === 'schedule') {
    return `daily sweep, at ${commit}`;
  }
  return pr ? `push of ${commit} ([#${pr}](${context.repoUrl}/pull/${pr}))` : `push of ${commit}`;
}

export function failureMessage(
  context: Context,
  jobs: FailedJob[],
  findings: Findings | null,
  lastGreen: Point | null,
): string {
  const lines = [`🚨 · **${context.workflow} failed on ${context.branch}** · ${which(context)}`];
  lines.push(`Failed jobs: ${jobsLine(context.workflow, jobs)}`);
  if (findings === null) {
    lines.push('No coverage report was written: the failed step’s log says what went wrong.');
  } else {
    const { failedTests, knownBugsPassing, otherProblems } = findings;
    if (failedTests.length > 0) {
      lines.push(`Failed tests (${failedTests.length}): ${names(failedTests)}`);
    }
    if (knownBugsPassing.length > 0) {
      lines.push(
        `Kept for a known bug and now passing, from the known-bug report rather than a gating test (${knownBugsPassing.length}): ${names(knownBugsPassing)}`,
      );
    }
    if (failedTests.length === 0 && knownBugsPassing.length === 0) {
      lines.push(
        otherProblems.length > 0
          ? `The coverage check failed: ${plain(otherProblems[0])}${otherProblems.length > 1 ? ` (and ${otherProblems.length - 1} more)` : ''}`
          : 'No test failed in the coverage report: the failed step’s log says what went wrong.',
      );
    }
  }
  if (lastGreen?.id === context.runId) {
    lines.push('An earlier attempt of this run passed: the failure may be flaky.');
  } else if (lastGreen?.head_sha === context.sha) {
    lines.push('This commit passed in an earlier run: the failure may be flaky.');
  } else if (lastGreen) {
    lines.push(
      `Last passed at ${code(short(lastGreen.head_sha))} · [changes since](${context.repoUrl}/compare/${lastGreen.head_sha}...${context.sha})`,
    );
  }
  lines.push(`[Run](${context.runUrl}) · [What to do](${context.repoUrl}/blob/main/${WHAT_TO_DO})`);
  return lines.join('\n');
}

export function recoveryMessage(
  context: Context,
  failingSince: Point,
  redRuns: number,
  atLeast: boolean,
): string {
  const runs = redRuns === 1 ? '1 run' : `${redRuns} runs`;
  const since =
    failingSince.id === context.runId
      ? 'It failed on an earlier attempt of this run.'
      : atLeast
        ? `It had failed for at least ${runs}, since ${code(short(failingSince.head_sha))} or earlier.`
        : `It had failed since ${code(short(failingSince.head_sha))}, in ${runs}.`;
  return [
    `✅ Resolved · **${context.workflow} passes again on ${context.branch}** · ${which(context)}`,
    `${since} [Run](${context.runUrl})`,
  ].join('\n');
}

async function github(path: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${env('GH_TOKEN')}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (response.ok) {
      return response.json();
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    const limited =
      response.status === 429 ||
      (response.status === 403 && (retryAfter > 0 || response.headers.get('x-ratelimit-remaining') === '0'));
    if (attempt === 3 || !(response.status >= 500 || limited)) {
      throw new Error(`GET ${path}: HTTP ${response.status} ${await response.text()}`);
    }
    const seconds = Math.min(retryAfter > 0 ? retryAfter : 5 * attempt, 60);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
}

/** The jobs of a run, or of one attempt of it (`<id>/attempts/<n>`). */
async function jobsOf(repo: string, run: string): Promise<Job[]> {
  return (await github(`/repos/${repo}/actions/runs/${run}/jobs?filter=latest&per_page=100`)).jobs;
}

export async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const id = Number(env('GITHUB_RUN_ID'));
  const attempt = Number(env('GITHUB_RUN_ATTEMPT'));
  const alertJob = env('EMAIL_E2E_ALERT_JOB');
  const [run, jobs, attempts] = await Promise.all([
    github(`/repos/${repo}/actions/runs/${id}`),
    jobsOf(repo, `${id}`),
    Promise.all(
      Array.from({ length: attempt - 1 }, (_, index) =>
        jobsOf(repo, `${id}/attempts/${attempt - 1 - index}`).then((each) =>
          outcome({ status: 'completed' } as StreamRun, each, alertJob),
        ),
      ),
    ),
  ]);
  const query = new URLSearchParams({ branch: run.head_branch, event: run.event, per_page: '30' });
  const stream: StreamRun[] = (
    await github(`/repos/${repo}/actions/workflows/${run.workflow_id}/runs?${query}`)
  ).workflow_runs;
  const suite = jobs.filter((job) => job.name !== alertJob);
  const failed = failedJobs(suite);
  const result = {
    red: failed.length > 0,
    endedAt: suite.map((job) => job.completed_at ?? '').sort().at(-1) ?? '',
  };
  const outcomes = new Map<number, Outcome>();
  let decision = decide({ run, result, attempts, stream, outcomes });
  while ('need' in decision) {
    outcomes.set(decision.need.id, outcome(decision.need, await jobsOf(repo, `${decision.need.id}`), alertJob));
    decision = decide({ run, result, attempts, stream, outcomes });
  }

  const context: Context = {
    runId: id,
    workflow: run.name,
    event: run.event,
    branch: run.head_branch,
    sha: run.head_sha,
    title: String(run.head_commit?.message ?? '').split('\n')[0],
    repoUrl: `${env('GITHUB_SERVER_URL')}/${repo}`,
    runUrl: run.html_url,
  };
  let summary: string;
  if (decision.post === null) {
    summary = `Nothing posted to Macro Alerts: ${decision.why}.`;
    appendFileSync(env('GITHUB_OUTPUT'), 'post=false\n');
  } else {
    const message =
      decision.post === 'failure'
        ? failureMessage(context, failed, readFindings(env('EMAIL_E2E_REPORTS')), decision.lastGreen)
        : recoveryMessage(context, decision.failingSince, decision.redRuns, decision.atLeast);
    writeFileSync(env('EMAIL_E2E_ALERT_MESSAGE'), message);
    appendFileSync(env('GITHUB_OUTPUT'), 'post=true\n');
    summary = `Posting to Macro Alerts:\n\n${message
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}`;
  }
  console.log(summary);
  appendFileSync(env('GITHUB_STEP_SUMMARY'), `### Macro Alerts\n\n${summary}\n`);
}

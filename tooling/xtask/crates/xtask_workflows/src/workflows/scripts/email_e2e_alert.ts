// Tells the Macro Alerts channel when an email end-to-end workflow turns red
// on `main`, and when it turns green again. The last job of `email_e2e.yml`,
// `email_e2e_browser.yml` and `email_e2e_full_stack.yml` runs it after every
// other job, as does that of `channels_e2e.yml`, on a push to `main` and in
// the daily sweep; never on a run by hand.
//
// A run posts only when its result differs from what the channel was last
// told about its stream: the workflow's runs on the same branch for the same
// event (the pushes, or the sweep). A red run posts the failure when the
// channel shows the stream passing; a green run posts that it passes again
// when the channel shows it failing; any other run posts nothing. Pushes and
// the sweep are apart because only the sweep runs the tests kept for known
// bugs: one of those that passes would otherwise turn the stream red at every
// sweep and green at the next push.
//
// The job records what the channel shows in its last step, "the channel shows
// it failing" or "the channel shows it passing", which runs only once a post
// succeeded or none was needed. The newest such step among the stream's recent
// runs, read through the jobs API, is what the channel shows; with none, it
// shows the stream passing. A stream's alert jobs run one at a time (a
// concurrency group), so each reads what the one before it left. A run posts
// nothing once a newer run has ended, since its result is not the branch's
// latest; the newer run's own alert job tells the channel, or, if that job
// never runs, the next run does. A failed post records nothing, so the next
// run posts again, as does a re-run of this job while no newer run has ended.
//
// A push that waited for the run before it and was replaced by a newer push
// (the workflows queue as the dev deploys do) ends as a cancelled run with no
// jobs, and a stream can hold several for each run that ended. Having no jobs,
// it neither records nor passes, and the job reads past it without counting it
// toward LOOK_BACK; the run after it tests the newer tree, and that run's
// failure names the last pass before it, so the changes since span its
// commit. A run is judged by its jobs, never by its conclusion: one whose job
// ran out of time is cancelled too, yet ran this job.
//
// A failure names the commit, each failed job with the step it failed at, and
// what the run's coverage report (downloaded to EMAIL_E2E_REPORTS) says
// failed: gating tests, tests kept for known bugs that now pass, or the
// coverage check itself. The step writes the message to
// EMAIL_E2E_ALERT_MESSAGE, `post=true` when there is one, and `shows=failing`
// or `shows=passing` to its outputs; the next steps post the message and record
// what the channel then shows. The message, or why there is none, goes to the
// job summary.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Conclusions of a finished job that mean it failed. A cancelled job counts:
 * this job runs only in a run that was not cancelled, so such a job ran out of
 * time.
 */
const RED = new Set(['failure', 'timed_out', 'cancelled']);

/** The most runs with jobs of the stream the job reads. */
export const LOOK_BACK = 30;

/**
 * How many of the stream's newest runs the job lists, the most a page holds:
 * runs replaced while they waited have no jobs, and are read past.
 */
const LISTED = 100;

/** How many runs' jobs the job reads at once. */
const BATCH = 5;

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
export type StreamRun = { id: number; run_number: number; head_sha: string };

/** A job of a run, as the jobs API lists it. */
export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  steps?: { name: string; conclusion: string | null; completed_at?: string | null }[];
};

/** A run and the jobs of all its attempts. */
export type Entry = { run: StreamRun; jobs: Job[] };

/** The names of the alert job and of its steps the script reads. */
export type Names = {
  job: string;
  post: string;
  /** The step that records that the channel shows the stream failing. */
  failing: string;
  /** The step that records that the channel shows the stream passing. */
  passing: string;
};

/** What one alert job recorded. */
export type Told = { run: StreamRun; failing: boolean; posted: boolean; at: string };

export type FailedJob = { name: string; step: string | null };

export type Decision = (
  | { post: 'failure'; lastGreen: StreamRun | null }
  | { post: 'recovery'; failingSince: StreamRun | null }
  | { post: null; why: string }
) & {
  /** Whether the channel shows the stream failing once this job is done. */
  failing: boolean;
};

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
 * results. Jobs still running, this one among them, are left out.
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

/** What each alert job of a run, in any attempt, recorded. */
export function records(entry: Entry, names: Names): Told[] {
  const done = (job: Job, name: string) =>
    job.steps?.find((step) => step.name === name && step.conclusion === 'success');
  return entry.jobs.flatMap((job) => {
    const shown = job.name === names.job ? (done(job, names.failing) ?? done(job, names.passing)) : undefined;
    return shown?.completed_at
      ? [
          {
            run: entry.run,
            failing: shown.name === names.failing,
            posted: done(job, names.post) !== undefined,
            at: shown.completed_at,
          },
        ]
      : [];
  });
}

/**
 * Whether a run passed, from the latest attempt of each of its jobs but the
 * alert job; null while one of them is still going.
 */
export function passed(entry: Entry, alertJob: string): boolean | null {
  const latest = new Map<string, Job>();
  for (const job of entry.jobs) {
    const seen = latest.get(job.name);
    if (job.name !== alertJob && (!seen || (job.run_attempt ?? 1) > (seen.run_attempt ?? 1))) {
      latest.set(job.name, job);
    }
  }
  const suite = [...latest.values()];
  if (suite.length === 0 || suite.some((job) => job.status !== 'completed')) {
    return null;
  }
  return failedJobs(suite).length === 0;
}

/**
 * Reads the stream's runs, newest first, a few at a time with `jobsOf`, until
 * the decision `judge` makes of them would not change or, by the end of a
 * batch, LOOK_BACK runs with jobs were read. A push replaced while it waited
 * has none: it is read but not counted, so replaced pushes do not crowd out
 * the runs that ended.
 */
export async function readStream(
  stream: StreamRun[],
  names: Names,
  judge: (entries: Entry[]) => Decision,
  jobsOf: (run: StreamRun) => Promise<Job[]>,
): Promise<Decision> {
  const entries: Entry[] = [];
  const ran = () => entries.filter((entry) => entry.jobs.length > 0).length;
  let decision = judge(entries);
  for (
    let start = 0;
    start < stream.length && ran() < LOOK_BACK && readMore(decision, entries, names);
    start += BATCH
  ) {
    const batch = stream.slice(start, start + BATCH);
    entries.push(...(await Promise.all(batch.map(async (run) => ({ run, jobs: await jobsOf(run) })))));
    decision = judge(entries);
  }
  return decision;
}

const short = (sha: string) => sha.slice(0, 7);

const newestFirst = (a: { run: StreamRun }, b: { run: StreamRun }) => b.run.run_number - a.run.run_number;

/**
 * Whether this run posts, from its result and the stream's recent runs
 * (`entries`, which may hold this run's earlier attempts).
 */
export function decide({
  run,
  red,
  entries,
  names,
}: {
  run: StreamRun;
  red: boolean;
  entries: Entry[];
  names: Names;
}): Decision {
  const recorded = entries.flatMap((entry) => records(entry, names)).sort((a, b) => b.at.localeCompare(a.at));
  const shown = recorded[0];
  const failing = shown?.failing ?? false;

  // A newer run that ended tells the channel itself, or has already; its
  // alert job may wait behind this one.
  const newer = entries
    .filter(
      (entry) =>
        entry.run.run_number > run.run_number &&
        (records(entry, names).length > 0 || passed(entry, names.job) !== null),
    )
    .sort(newestFirst)[0];
  if (newer) {
    return {
      post: null,
      failing,
      why: `run #${newer.run.run_number}, which is newer, has ended, so this result is not the branch's latest`,
    };
  }
  if (red && !failing) {
    const lastGreen = entries
      .filter((entry) => entry.run.run_number < run.run_number && passed(entry, names.job) === true)
      .sort(newestFirst)[0];
    return { post: 'failure', failing: true, lastGreen: lastGreen?.run ?? null };
  }
  if (!red && failing) {
    const since = recorded.find((record) => record.failing && record.posted);
    return { post: 'recovery', failing: false, failingSince: since?.run ?? null };
  }
  const as = shown ? ` (since run #${shown.run.run_number}, at ${short(shown.run.head_sha)})` : '';
  return {
    post: null,
    failing,
    why: red
      ? `the channel already shows it failing${as}`
      : shown
        ? `it passed, and the channel already shows it passing${as}`
        : 'it passed, and the channel was never told otherwise',
  };
}

/** Whether a decision would change if the job read more runs. */
export function readMore(decision: Decision, entries: Entry[], names: Names): boolean {
  return (
    !entries.some((entry) => records(entry, names).length > 0) ||
    (decision.post === 'failure' && decision.lastGreen === null) ||
    (decision.post === 'recovery' && decision.failingSince === null)
  );
}

type PlaywrightSpec = {
  title: string;
  file: string;
  line: number;
  tests: { status: string; expectedStatus?: string }[];
};
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

/** What a message says of a spec marked to fail (`test.fail()`) that passed. */
const MARKED_TO_FAIL = ' (marked as a known defect, and now passes)';

/**
 * What the one Playwright report of a suite with no coverage check says failed
 * (the channels suite's `playwright-report.json`). Its tests for known defects
 * run in every run, marked to fail, so one that passes fails the run: it is
 * named with the failed tests, and said to be that.
 */
export function suiteFindings(report: { suites?: PlaywrightSuite[] }): Findings {
  const unexpected = (spec: PlaywrightSpec) => spec.tests.filter((test) => test.status === 'unexpected');
  const walk = (suites: PlaywrightSuite[] = []): string[] =>
    suites.flatMap((suite) => [
      ...(suite.specs ?? [])
        .filter((spec) => unexpected(spec).length > 0)
        .map((spec) => {
          const marked = unexpected(spec).some((test) => test.expectedStatus === 'failed');
          return `${spec.file}:${spec.line} ${spec.title}${marked ? MARKED_TO_FAIL : ''}`;
        }),
      ...walk(suite.suites),
    ]);
  return { failedTests: walk(report.suites), knownBugsPassing: [], otherProblems: [] };
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
  if (existsSync(`${dir}/playwright-report.json`)) {
    return suiteFindings(read('playwright-report.json'));
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
  lastGreen: StreamRun | null,
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
  if (lastGreen?.head_sha === context.sha) {
    lines.push('This commit passed in an earlier run: the failure may be flaky.');
  } else if (lastGreen) {
    lines.push(
      `Last passed at ${code(short(lastGreen.head_sha))} · [changes since](${context.repoUrl}/compare/${lastGreen.head_sha}...${context.sha})`,
    );
  }
  lines.push(`[Run](${context.runUrl}) · [What to do](${context.repoUrl}/blob/main/${WHAT_TO_DO})`);
  return lines.join('\n');
}

export function recoveryMessage(context: Context, failingSince: StreamRun | null): string {
  const since =
    failingSince === null
      ? ''
      : failingSince.id === context.runId
        ? 'It failed on an earlier attempt of this run. '
        : `It had failed since ${code(short(failingSince.head_sha))}. `;
  return [
    `✅ Resolved · **${context.workflow} passes again on ${context.branch}** · ${which(context)}`,
    `${since}[Run](${context.runUrl})`,
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

async function jobsOf(repo: string, run: number, filter: 'latest' | 'all'): Promise<Job[]> {
  return (await github(`/repos/${repo}/actions/runs/${run}/jobs?filter=${filter}&per_page=100`)).jobs;
}

export async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const id = Number(env('GITHUB_RUN_ID'));
  const names: Names = {
    job: env('EMAIL_E2E_ALERT_JOB'),
    post: env('EMAIL_E2E_ALERT_POST_STEP'),
    failing: env('EMAIL_E2E_ALERT_FAILING_STEP'),
    passing: env('EMAIL_E2E_ALERT_PASSING_STEP'),
  };
  const [run, jobs] = await Promise.all([github(`/repos/${repo}/actions/runs/${id}`), jobsOf(repo, id, 'latest')]);
  const failed = failedJobs(jobs.filter((job) => job.name !== names.job));

  const query = new URLSearchParams({ branch: run.head_branch, event: run.event, per_page: `${LISTED}` });
  const stream: StreamRun[] = (await github(`/repos/${repo}/actions/workflows/${run.workflow_id}/runs?${query}`))
    .workflow_runs;
  const decision = await readStream(
    stream,
    names,
    (entries) => decide({ run, red: failed.length > 0, entries, names }),
    (each) => jobsOf(repo, each.id, 'all'),
  );

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
  const outputs = [`shows=${decision.failing ? 'failing' : 'passing'}`];
  let summary: string;
  if (decision.post === null) {
    summary = `Nothing posted to Macro Alerts: ${decision.why}.`;
    outputs.push('post=false');
  } else {
    const message =
      decision.post === 'failure'
        ? failureMessage(context, failed, readFindings(env('EMAIL_E2E_REPORTS')), decision.lastGreen)
        : recoveryMessage(context, decision.failingSince);
    writeFileSync(env('EMAIL_E2E_ALERT_MESSAGE'), message);
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

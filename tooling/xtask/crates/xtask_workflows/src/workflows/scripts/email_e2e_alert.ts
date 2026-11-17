// Tells the Macro Alerts channel when an email end-to-end workflow turns red
// on `main`, and when it turns green again. The last job of `email_e2e.yml`,
// `email_e2e_browser.yml` and `email_e2e_full_stack.yml` runs it after every
// other job, on a push to `main` and in the daily sweep; never on a run by
// hand.
//
// A run posts at most one message, and only when it changes the state of its
// stream: the workflow's finished runs on the same branch for the same event
// (the pushes, or the sweep). The first red run after a green one posts the
// failure; the first green run after a red one posts that it passes again. A
// red run after a red one posts nothing, since one broken test fails every run
// after it until it is fixed. Nor does a run that ends after a newer run of its
// stream has ended: its result is no longer the branch's. A re-run is compared
// with its own previous attempt. Pushes and the sweep are apart because only
// the sweep runs the tests kept for known bugs: one of those that passes would
// otherwise turn the stream red at every sweep and green at the next push.
//
// A failure names the commit, each failed job with the step it failed at, and
// what the run's coverage report (downloaded to EMAIL_E2E_REPORTS) says
// failed: gating tests, tests kept for known bugs that now pass, or the
// coverage check itself. The step writes the message to
// EMAIL_E2E_ALERT_MESSAGE and `post=true` to its outputs, and the next step
// posts it. The message, or why there is none, goes to the job summary.

import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Conclusions of a finished run or job that mean it failed. */
const RED = new Set(['failure', 'timed_out']);

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

/** A finished run of the workflow, as the runs API lists it. */
export type StreamRun = {
  id: number;
  run_number: number;
  head_sha: string;
  conclusion: string | null;
};

/** A job of this run, as the jobs API lists it. */
export type Job = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps?: { name: string; conclusion: string | null }[];
};

export type FailedJob = { name: string; step: string | null };

export type Decision =
  | { post: 'failure'; lastGreen: StreamRun | null }
  | { post: 'recovery'; failingSince: string; redRuns: number }
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
 * The run's jobs that failed, each with the first step that failed, in the
 * order the run started them: the suite's before the coverage job that reads
 * their results. A job that was cancelled counts: this job runs only in a run
 * that was not cancelled, so such a job ran out of time. Jobs still running,
 * this one, are left out.
 */
export function failedJobs(jobs: Job[]): FailedJob[] {
  const failed = (conclusion: string | null) =>
    RED.has(conclusion ?? '') || conclusion === 'cancelled';
  return jobs
    .filter((job) => job.status === 'completed' && failed(job.conclusion))
    .sort((a, b) => a.id - b.id)
    .map((job) => ({
      name: job.name,
      step: job.steps?.find((step) => failed(step.conclusion))?.name ?? null,
    }));
}

/**
 * Whether this run posts, from its own result and the stream's finished runs.
 * `previousAttempt` is the conclusion of this run's previous attempt, null on a
 * first attempt.
 */
export function decide({
  red,
  run,
  previousAttempt,
  history,
}: {
  red: boolean;
  run: StreamRun;
  previousAttempt: string | null;
  history: StreamRun[];
}): Decision {
  const ended = history.filter(
    (each) =>
      each.id !== run.id && (each.conclusion === 'success' || RED.has(each.conclusion ?? '')),
  );
  const newer = ended.filter((each) => each.run_number > run.run_number);
  if (newer.length > 0) {
    const latest = Math.max(...newer.map((each) => each.run_number));
    return {
      post: null,
      why: `run #${latest}, which is newer, has already ended, so this result is not the branch's latest`,
    };
  }
  const attempt =
    previousAttempt === 'success' || RED.has(previousAttempt ?? '')
      ? [{ ...run, conclusion: previousAttempt }]
      : [];
  const before = [
    ...attempt,
    ...ended
      .filter((each) => each.run_number < run.run_number)
      .sort((a, b) => b.run_number - a.run_number),
  ];
  const wasRed = before.length > 0 && RED.has(before[0].conclusion ?? '');
  const previous =
    before.length === 0
      ? 'no run before it ended'
      : before[0].id === run.id
        ? 'its previous attempt'
        : `run #${before[0].run_number} (at ${before[0].head_sha.slice(0, 7)})`;
  if (red) {
    return wasRed
      ? {
          post: null,
          why: `${previous} failed too, and only the first red run of a streak posts`,
        }
      : { post: 'failure', lastGreen: before[0] ?? null };
  }
  if (!wasRed) {
    return {
      post: null,
      why: before.length > 0 ? `it passed, as ${previous} did` : `it passed, and ${previous}`,
    };
  }
  const end = before.findIndex((each) => !RED.has(each.conclusion ?? ''));
  const streak = end === -1 ? before : before.slice(0, end);
  return {
    post: 'recovery',
    failingSince: streak[streak.length - 1].head_sha,
    // A run that failed in two attempts is one run.
    redRuns: new Set(streak.map((each) => each.id)).size,
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

const short = (sha: string) => sha.slice(0, 7);

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

export function recoveryMessage(context: Context, failingSince: string, redRuns: number): string {
  const since =
    failingSince === context.sha
      ? 'It failed on an earlier attempt of this run.'
      : `It had failed since ${code(short(failingSince))}, ${redRuns === 1 ? 'in 1 run' : `in ${redRuns} runs`}.`;
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
    if (attempt === 3 || response.status < 500) {
      throw new Error(`GET ${path}: HTTP ${response.status} ${await response.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

export async function main() {
  const repo = env('GITHUB_REPOSITORY');
  const id = env('GITHUB_RUN_ID');
  const attempt = Number(env('GITHUB_RUN_ATTEMPT'));
  const run = await github(`/repos/${repo}/actions/runs/${id}`);
  const failed = failedJobs(
    (await github(`/repos/${repo}/actions/runs/${id}/jobs?filter=latest&per_page=100`)).jobs,
  );
  const query = new URLSearchParams({
    branch: run.head_branch,
    event: run.event,
    status: 'completed',
    per_page: '50',
  });
  const history: StreamRun[] = (
    await github(`/repos/${repo}/actions/workflows/${run.workflow_id}/runs?${query}`)
  ).workflow_runs;
  const previousAttempt =
    attempt > 1 ? (await github(`/repos/${repo}/actions/runs/${id}/attempts/${attempt - 1}`)).conclusion : null;
  const decision = decide({ red: failed.length > 0, run, previousAttempt, history });

  const context: Context = {
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
        : recoveryMessage(context, decision.failingSince, decision.redRuns);
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

// Sets the commit status `main` requires before a merge: it is green only on a
// commit that a requested `PR CI` run passed. `CI_GATE_MODE` picks the step:
//
//   remind  a new commit: pending "not run" with the command to run it, unless
//           the commit already has a gate status
//   start   a requested run begins: remove the label, check the merge commit
//           holds the PR head, set pending
//   finish  the run ends: success when every job passed or was path-skipped
//   fork-request  the label goes on a fork PR: what start does with a write
//                 token, from a trusted run of `main`'s workflow
//   fork    after a fork PR's run, whose read-only token could not set the status
//
// Statuses go on the PR head commit, so a later push starts without one.

import { readFileSync } from 'node:fs';

const API = 'https://api.github.com';
const DESCRIPTION_LIMIT = 140;
// An open request. Only trusted runs set statuses: a fork's token can't.
const RUNNING = 'Running on';
// Job names in `PR CI`; the fork step reads them back from the finished run.
export const START_JOB = 'Start';
export const GATE_JOB = 'CI gate';

type State = 'pending' | 'success' | 'failure' | 'error';
export type Needs = Record<string, { result: string }>;
export type RunJob = { name: string; conclusion: string | null };
type Outcome = { state: State; description: string } | null;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

async function github(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env('GH_TOKEN')}`,
      'x-github-api-version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Removing a label that is already gone is the outcome we wanted.
  if (method === 'DELETE' && response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

const repo = () => env('GITHUB_REPOSITORY');
const context = () => env('CI_GATE_CONTEXT');
const label = () => env('CI_GATE_LABEL');

/// REST, because `gh pr edit` fails on older gh releases.
export function runCommand(repository: string, pr: string, labelName: string): string {
  return `gh api repos/${repository}/issues/${pr}/labels -f "labels[]=${labelName}"`;
}

/// The finished run's verdict from `toJSON(needs)`. Start must have succeeded;
/// a called workflow may be skipped, because its path filter did not match.
/// Null when start failed: it already set a status that says why.
export function gateOutcome(needs: Needs, head: string): Outcome {
  if (needs.start?.result !== 'success') {
    return null;
  }

  const failed = Object.entries(needs)
    .filter(([, need]) => need.result !== 'success' && need.result !== 'skipped')
    .map(([job]) => job);

  if (failed.length > 0) {
    return { state: 'failure', description: `Failed: ${failed.join(', ')}` };
  }

  return { state: 'success', description: `Passed on ${head.slice(0, 7)}` };
}

/// A fork run's verdict from its jobs. Null when the run was not a request
/// (unrelated label) or did not finish (cancelled).
export function forkOutcome(jobs: RunJob[], head: string, labelName: string): Outcome {
  const start = jobs.find((job) => job.name === START_JOB);
  const gate = jobs.find((job) => job.name === GATE_JOB);

  if (!start || start.conclusion === 'skipped' || start.conclusion === 'cancelled') {
    return null;
  }

  if (start.conclusion !== 'success') {
    return {
      state: 'failure',
      description: `Could not start on ${head.slice(0, 7)}. Add the ${labelName} label again.`,
    };
  }

  if (gate?.conclusion === 'success') {
    return { state: 'success', description: `Passed on ${head.slice(0, 7)}` };
  }

  if (gate?.conclusion === 'failure') {
    return { state: 'failure', description: 'Failed: see the PR CI run' };
  }

  return null;
}

async function setStatus(sha: string, state: State, description: string, targetUrl: string) {
  await github('POST', `/repos/${repo()}/statuses/${sha}`, {
    state,
    context: context(),
    description: description.slice(0, DESCRIPTION_LIMIT),
    target_url: targetUrl,
  });
  console.log(`${context()} on ${sha.slice(0, 10)}: ${state}: ${description}`);
}

/// The newest gate status on a commit (GitHub lists statuses newest first).
async function gateStatus(sha: string): Promise<{ state: string; description: string } | undefined> {
  const statuses: { context: string; state: string; description: string | null }[] = await github(
    'GET',
    `/repos/${repo()}/commits/${sha}/statuses?per_page=100`,
  );
  const status = statuses.find((each) => each.context === context());
  return status && { state: status.state, description: status.description ?? '' };
}

/// Whether a trusted step opened a request on this commit that no result has
/// closed yet.
export function isOpenRequest(status: { state: string; description: string } | undefined): boolean {
  return status?.state === 'pending' && status.description.startsWith(RUNNING);
}

async function removeLabel(pr: string) {
  await github('DELETE', `/repos/${repo()}/issues/${pr}/labels/${encodeURIComponent(label())}`);
}

async function remind() {
  const head = env('HEAD_SHA');
  const pr = env('PR_NUMBER');

  // A re-open or leaving draft keeps the head, so it may have a result already.
  if (await gateStatus(head)) {
    console.log(`${head.slice(0, 10)} already has a ${context()} status`);
    return;
  }

  await setStatus(
    head,
    'pending',
    `Not run on this commit. Run: ${runCommand(repo(), pr, label())}`,
    env('CI_GATE_DOCS_URL'),
  );
}

async function start() {
  const head = env('HEAD_SHA');
  const pr = env('PR_NUMBER');
  const runUrl = env('RUN_URL');
  const sameRepo = env('SAME_REPO') === 'true';

  // Fork tokens are read-only; the fork request step did both already.
  if (sameRepo) {
    await removeLabel(pr);
  }

  // A label added right after a push can see a merge commit GitHub has not
  // rebuilt yet, which would test the previous head.
  const merge = await github('GET', `/repos/${repo()}/commits/${env('MERGE_SHA')}`);
  const parents: string[] = merge.parents.map((parent: { sha: string }) => parent.sha);

  if (!parents.includes(head)) {
    const description = `The merge commit did not include ${head.slice(0, 7)} yet. Run again: ${runCommand(repo(), pr, label())}`;
    if (sameRepo) {
      await setStatus(head, 'failure', description, runUrl);
    }
    throw new Error(description);
  }

  if (sameRepo) {
    await setStatus(head, 'pending', `${RUNNING} ${head.slice(0, 7)}`, runUrl);
  }
}

async function finish() {
  const head = env('HEAD_SHA');
  const outcome = gateOutcome(JSON.parse(env('NEEDS')), head);

  if (!outcome) {
    console.log('Start did not succeed; its status stands.');
    process.exitCode = 1;
    return;
  }

  if (env('SAME_REPO') === 'true') {
    await setStatus(head, outcome.state, outcome.description, env('RUN_URL'));
  }

  if (outcome.state !== 'success') {
    console.log(outcome.description);
    process.exitCode = 1;
  }
}

async function forkRequest() {
  const head = env('HEAD_SHA');
  const pr = env('PR_NUMBER');

  await removeLabel(pr);
  await setStatus(head, 'pending', `${RUNNING} ${head.slice(0, 7)}`, env('PR_CHECKS_URL'));
}

async function fork() {
  const event = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8'));
  const run = event.workflow_run;
  const head: string = run.head_sha;

  // The request step opened this on the head the label was added at. A run on
  // any other commit, such as one the fork pushed with a rewritten workflow,
  // or a run after the result is in, finds no open request.
  if (!isOpenRequest(await gateStatus(head))) {
    console.log(`${head.slice(0, 10)} has no open ${context()} request; nothing to report.`);
    return;
  }

  const jobs: RunJob[] = [];
  for (let page = 1; ; page++) {
    const { jobs: batch } = await github(
      'GET',
      `/repos/${repo()}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`,
    );
    jobs.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  const outcome = forkOutcome(jobs, head, label());
  if (outcome) {
    await setStatus(head, outcome.state, outcome.description, run.html_url);
  }
}

export async function main() {
  const modes: Record<string, () => Promise<void>> = {
    remind,
    start,
    finish,
    'fork-request': forkRequest,
    fork,
  };
  const mode = modes[env('CI_GATE_MODE')];
  if (!mode) {
    throw new Error(`unknown CI_GATE_MODE ${process.env.CI_GATE_MODE}`);
  }
  await mode();
}

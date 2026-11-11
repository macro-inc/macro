// Sets the commit status `main` requires before a merge: it is green only on a
// commit that a requested `PR CI` run passed. `CI_GATE_MODE` picks the step:
//
//   remind  a new commit: pending "not run" with the command to run it, unless
//           the commit already has a gate status
//   start   a requested run begins: remove the label, check the merge commit
//           holds the PR head, set pending
//   finish  the run ends: success when every job passed or was path-skipped
//   label   the label goes on a PR: fail when it can't start PR CI, because the
//           PR targets another branch, conflicts with main, or its merge commit
//           predates PR CI
//   run-end a run ends: fail when its attempt left no verdict, because GitHub
//           ended it without the gate job, or it was cancelled
//   fork-request  the label goes on a fork PR: what start does with a write
//                 token, from a trusted run of `main`'s workflow
//   fork    after a fork PR's run, whose read-only token could not set the status
//
// Statuses go on the PR head commit, so a later push starts without one. Every
// pending `Running on` request ends in a result: finish or fork sets it, and
// run-end or fork closes one the run left open.
//
// A fork PR's run uses the workflow files of its merge commit, so a fork that
// edits them decides its own verdict. Both fork steps fail closed instead: the
// fork's CI sources must be the trees it branched from (`ciSourceChanges`).

import { readFileSync } from 'node:fs';

const API = 'https://api.github.com';
const DESCRIPTION_LIMIT = 140;
// An open request. Only trusted runs set statuses: a fork's token can't.
const RUNNING = 'Running on';
// Job names in `PR CI`; the fork step reads them back from the finished run.
export const START_JOB = 'Start';
export const GATE_JOB = 'CI gate';
// The only base branch PR CI runs on.
export const BASE = 'main';
// The workflow whose jobs the fork step trusts, and the trees that define it:
// the generated workflows and the Rust that generates them.
export const PR_CI_PATH = '.github/workflows/pr-ci.yml';
export const CI_SOURCES = ['.github', 'tooling/xtask/crates/xtask_workflows'] as const;
export const STALE_MERGE =
  "PR CI can't start: this PR's merge commit predates PR CI. Merge main in, push, and add the run-ci label again.";
export const CONFLICTS =
  "PR CI can't start: this PR conflicts with main. Merge main in, push, and add the run-ci label again.";
export const WRONG_BASE =
  "PR CI can't start: it runs only on PRs into main, and this PR targets another branch. Add the run-ci label once it targets main.";
// A run-end or fork step found the request a run left open.
export const NO_VERDICT = 'no-verdict';
export const FORK_CHANGES_CI =
  'fork changes CI workflows: a maintainer must review and run CI from a branch';

type State = 'pending' | 'success' | 'failure' | 'error';
export type Needs = Record<string, { result: string }>;
export type RunJob = { name: string; conclusion: string | null };
type Verdict = { state: State; description: string };
type Outcome = Verdict | null;
export type GateStatus = {
  state: string;
  description: string;
  targetUrl: string;
  createdAt: string;
};
/// The fields of a `workflow_run` the run-end and fork steps read.
type FinishedRun = {
  id: number;
  workflow_id: number;
  head_sha: string;
  conclusion: string | null;
  html_url: string;
  path: string;
  run_attempt: number;
  /// When the run's latest attempt started.
  run_started_at: string;
  pull_requests?: { number: number }[];
};
/// Git tree SHA of each CI source at a commit; null where the path is missing.
export type CiTrees = Record<string, string | null>;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/// Whether a path exists at a ref.
async function exists(path: string, ref: string): Promise<boolean> {
  const response = await fetch(`${API}/repos/${repo()}/contents/${path}?ref=${ref}`, {
    method: 'HEAD',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${env('GH_TOKEN')}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`HEAD contents/${path}?ref=${ref}: HTTP ${response.status}`);
  }
  return true;
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
/// (unrelated label); `NO_VERDICT` when it was one that ended without a gate
/// verdict: cancelled, or GitHub never ran the gate job.
export function forkOutcome(
  jobs: RunJob[],
  head: string,
  labelName: string,
): Verdict | typeof NO_VERDICT | null {
  const start = jobs.find((job) => job.name === START_JOB);
  const gate = jobs.find((job) => job.name === GATE_JOB);

  // Every run has a Start job; a run for another label skips it.
  if (start?.conclusion === 'skipped') {
    return null;
  }

  // A cancelled or missing start falls through to `NO_VERDICT`.
  if (start && start.conclusion !== 'success' && start.conclusion !== 'cancelled') {
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

  return NO_VERDICT;
}

/// The result for a request whose run ended without a verdict. `retry` says
/// how to run CI again.
export function noVerdict(conclusion: string | null, retry: string): Verdict {
  const what =
    conclusion === 'cancelled'
      ? 'PR CI was cancelled before its verdict'
      : 'PR CI ended without a verdict';
  return { state: 'failure', description: `${what}. ${retry}` };
}

/// Whether another run on the same head is still going. A newer request
/// cancels the older run, and its start step takes the status over.
export function anotherRunGoing(runs: { id: number; status: string }[], runId: number): boolean {
  return runs.some((other) => other.id !== runId && other.status !== 'completed');
}

/// The CI sources whose tree differs between a fork head and the commit it
/// branched from. A source missing from either side counts as changed.
export function ciSourceChanges(head: CiTrees, base: CiTrees): string[] {
  return CI_SOURCES.filter((path) => !head[path] || !base[path] || head[path] !== base[path]);
}

/// Why a finished fork run can't be trusted, or null. The workflow is matched
/// by name, so a fork can add another file named `PR CI`; and even `pr-ci.yml`
/// is the fork's copy unless the CI sources are unchanged.
export function forkRunDistrust(runPath: string, changes: string[]): string | null {
  if (changes.length > 0) {
    return FORK_CHANGES_CI;
  }
  if (runPath !== PR_CI_PATH) {
    return `The run came from ${runPath}, not ${PR_CI_PATH}`;
  }
  return null;
}

/// Why the label can't start PR CI, or null. PR CI runs only on PRs into
/// main. GitHub runs no `pull_request` workflow on a conflicting PR, and takes
/// the workflow files from the PR's merge commit, which it refreshes on a push
/// but not when main moves on.
export function labelBlocker(
  base: string,
  mergeable: boolean | null,
  mergeHasPrCi: boolean,
): string | null {
  if (base !== BASE) {
    return WRONG_BASE;
  }
  if (mergeable === false) {
    return CONFLICTS;
  }
  if (!mergeHasPrCi) {
    return STALE_MERGE;
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
async function gateStatus(sha: string): Promise<GateStatus | undefined> {
  const statuses: {
    context: string;
    state: string;
    description: string | null;
    target_url: string | null;
    created_at: string;
  }[] = await github('GET', `/repos/${repo()}/commits/${sha}/statuses?per_page=100`);
  const status = statuses.find((each) => each.context === context());
  return (
    status && {
      state: status.state,
      description: status.description ?? '',
      targetUrl: status.target_url ?? '',
      createdAt: status.created_at,
    }
  );
}

/// Whether a trusted step opened a request on this commit that no result has
/// closed yet.
export function isOpenRequest(
  status: Pick<GateStatus, 'state' | 'description'> | undefined,
): boolean {
  return status?.state === 'pending' && status.description.startsWith(RUNNING);
}

/// Whether a run's latest attempt ended without a verdict on the head: the
/// newest status is this run's (start and the gate job link it to the run),
/// and it is start's open request, or a result from an earlier attempt that
/// a re-run of failed jobs never replaced.
export function leftWithoutVerdict(
  status: GateStatus | undefined,
  run: Pick<FinishedRun, 'id' | 'run_started_at'>,
): boolean {
  if (!status?.targetUrl.endsWith(`/actions/runs/${run.id}`)) {
    return false;
  }
  return isOpenRequest(status) || Date.parse(status.createdAt) < Date.parse(run.run_started_at);
}

/// The tree SHA at `path` in a commit, walking one directory at a time.
async function treeAt(commit: string, path: string): Promise<string | null> {
  let tree: string = (await github('GET', `/repos/${repo()}/git/commits/${commit}`)).tree.sha;
  for (const part of path.split('/')) {
    const { tree: entries }: { tree: { path: string; type: string; sha: string }[] } = await github(
      'GET',
      `/repos/${repo()}/git/trees/${tree}`,
    );
    const entry = entries.find((each) => each.path === part && each.type === 'tree');
    if (!entry) {
      return null;
    }
    tree = entry.sha;
  }
  return tree;
}

async function ciTrees(commit: string): Promise<CiTrees> {
  const trees: CiTrees = {};
  for (const path of CI_SOURCES) {
    trees[path] = await treeAt(commit, path);
  }
  return trees;
}

/// The CI sources a fork head changed since it branched from `base`.
async function forkCiChanges(base: string, head: string): Promise<string[]> {
  const compare = await github('GET', `/repos/${repo()}/compare/${base}...${head}`);
  const changes = ciSourceChanges(await ciTrees(head), await ciTrees(compare.merge_base_commit.sha));
  if (changes.length > 0) {
    console.log(`${head.slice(0, 10)} changes ${changes.join(', ')}`);
  }
  return changes;
}

async function removeLabel(pr: string) {
  await github('DELETE', `/repos/${repo()}/issues/${pr}/labels/${encodeURIComponent(label())}`);
}

/// Why a label on the PR can't start PR CI, from GitHub's view of it now.
/// GitHub computes mergeability in the background, so wait briefly for it.
async function labelProblem(pr: string): Promise<string | null> {
  let pull = await github('GET', `/repos/${repo()}/pulls/${pr}`);
  for (let attempt = 0; pull.mergeable === null && attempt < 6; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    pull = await github('GET', `/repos/${repo()}/pulls/${pr}`);
  }
  const merge: string | null = pull.merge_commit_sha;
  const hasPrCi = merge !== null && (await exists(PR_CI_PATH, merge));
  return labelBlocker(pull.base.ref, pull.mergeable, hasPrCi);
}

async function labelCheck() {
  const head = env('HEAD_SHA');
  const pr = env('PR_NUMBER');
  const problem = await labelProblem(pr);
  if (!problem) {
    console.log(`#${pr}'s merge commit holds ${PR_CI_PATH}; PR CI takes it from here.`);
    return;
  }
  // The label stays otherwise, and adding it again must fire a new event.
  await removeLabel(pr);
  await setStatus(head, 'failure', problem, env('CI_GATE_DOCS_URL'));
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

  // A label added right after a push can carry the previous head, or a merge
  // commit GitHub has not rebuilt yet. Either would test an old commit.
  const pull = await github('GET', `/repos/${repo()}/pulls/${pr}`);
  if (pull.head.sha !== head) {
    const description = `The PR moved on from ${head.slice(0, 7)} to ${pull.head.sha.slice(0, 7)}. Run again: ${runCommand(repo(), pr, label())}`;
    if (sameRepo) {
      await setStatus(head, 'failure', description, runUrl);
    }
    throw new Error(description);
  }

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

/// Fail a request the run left open, unless a newer run on the head took it
/// over.
async function closeWithoutVerdict(run: FinishedRun, retry: string) {
  const query = `head_sha=${run.head_sha}&per_page=100`;
  const { workflow_runs: runs } = await github(
    'GET',
    `/repos/${repo()}/actions/workflows/${run.workflow_id}/runs?${query}`,
  );
  if (anotherRunGoing(runs, run.id)) {
    console.log(`Another run on ${run.head_sha.slice(0, 10)} is going; it owns the request.`);
    return;
  }
  const verdict = noVerdict(run.conclusion, retry);
  await setStatus(run.head_sha, verdict.state, verdict.description, run.html_url);
}

async function runEnd() {
  const run: FinishedRun = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8')).workflow_run;

  // The gate job replaces start's request with a result, on every attempt.
  if (!leftWithoutVerdict(await gateStatus(run.head_sha), run)) {
    console.log(`${run.head_sha.slice(0, 10)} has this attempt's verdict, or another run's status.`);
    return;
  }

  const pr = run.pull_requests?.[0]?.number;
  const retry =
    pr === undefined
      ? `Add the ${label()} label again.`
      : `Run again: ${runCommand(repo(), String(pr), label())}`;
  await closeWithoutVerdict(run, retry);
}

async function forkRequest() {
  const head = env('HEAD_SHA');
  const pr = env('PR_NUMBER');

  await removeLabel(pr);

  const problem = await labelProblem(pr);
  if (problem) {
    await setStatus(head, 'failure', problem, env('CI_GATE_DOCS_URL'));
    return;
  }

  // The run the label starts would use the fork's own workflow files.
  if ((await forkCiChanges(env('BASE_REF'), head)).length > 0) {
    await setStatus(head, 'failure', FORK_CHANGES_CI, env('PR_CHECKS_URL'));
    return;
  }

  await setStatus(head, 'pending', `${RUNNING} ${head.slice(0, 7)}`, env('PR_CHECKS_URL'));
}

async function fork() {
  const run: FinishedRun = JSON.parse(readFileSync(env('GITHUB_EVENT_PATH'), 'utf8')).workflow_run;
  const head = run.head_sha;

  // The request step opened this on the head the label was added at. A run on
  // any other commit, such as one the fork pushed with a rewritten workflow,
  // or a run after the result is in, finds no open request.
  if (!isOpenRequest(await gateStatus(head))) {
    console.log(`${head.slice(0, 10)} has no open ${context()} request; nothing to report.`);
    return;
  }

  // Checked again here, from the run itself: the request step's view could be
  // stale, and the run's path is only known now.
  const distrust = forkRunDistrust(run.path, await forkCiChanges(env('BASE_REF'), head));
  if (distrust) {
    await setStatus(head, 'failure', distrust, run.html_url);
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
  if (outcome === NO_VERDICT) {
    await closeWithoutVerdict(run, `Add the ${label()} label again.`);
  } else if (outcome) {
    await setStatus(head, outcome.state, outcome.description, run.html_url);
  }
}

export async function main() {
  const modes: Record<string, () => Promise<void>> = {
    remind,
    label: labelCheck,
    start,
    finish,
    'run-end': runEnd,
    'fork-request': forkRequest,
    fork,
  };
  const mode = modes[env('CI_GATE_MODE')];
  if (!mode) {
    throw new Error(`unknown CI_GATE_MODE ${process.env.CI_GATE_MODE}`);
  }
  await mode();
}

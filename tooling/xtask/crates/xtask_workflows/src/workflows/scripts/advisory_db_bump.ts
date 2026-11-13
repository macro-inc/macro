// Moves the RustSec advisory database pin that cargo-deny reads (`REV_FILE`)
// to the latest advisory-db commit, in one open PR from `BUMP_BRANCH` into
// `BUMP_BASE`. `BUMP_MODE` picks the step:
//
//   prepare  check out the open PR's branch, or a new one from the base, and
//            write the latest commit into the pin file; output `changed`, and
//            the base's pin, the new pin and the open PR when it changed
//   publish  commit, push, set the `cla` status, then open the PR or rewrite
//            its description with cargo-deny's result on the new pin
//            (`DENY_OUTCOME`)
//
// A run adds a commit to the open PR's branch instead of rebuilding it, so a
// fix or ignore pushed there survives the next day's bump.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.github.com';
const ADVISORY_DB = 'https://github.com/rustsec/advisory-db';
const BOT_NAME = 'github-actions[bot]';
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const repo = () => env('GITHUB_REPOSITORY');
const branch = () => env('BUMP_BRANCH');
const base = () => env('BUMP_BASE');
const revFile = () => env('REV_FILE');

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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
  if (!response.ok) {
    throw new Error(`${method} ${path}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function output(values: Record<string, string>) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`);
  appendFileSync(env('GITHUB_OUTPUT'), lines.join(''));
}

const short = (rev: string) => rev.slice(0, 7);

function title(to: string): string {
  return `ci(cargo-deny): move the advisory database pin to ${short(to)}`;
}

/// The PR description: what moved, and whether cargo-deny passed on it when
/// it moved. Fixes pushed later show in CI, not here.
function description(from: string, to: string, denyOutcome: string, runUrl: string): string {
  const result =
    denyOutcome === 'success'
      ? `cargo-deny passed on the new pin ([run](${runUrl})).`
      : `cargo-deny failed on the new pin ([run](${runUrl})). ` +
        'Push the fix to this branch: update the crate, or ignore the advisory in `deny.toml` with a reason.';

  return [
    '## Why',
    '',
    `cargo-deny reads the RustSec advisory database at the commit in \`${revFile()}\`, ` +
      'so a newly published advisory fails this PR instead of every PR that touches Cargo files.',
    '',
    '## What',
    '',
    `Moves the pin from \`${short(from)}\` to \`${short(to)}\` ` +
      `([advisory-db changes](${ADVISORY_DB}/compare/${from}...${to})).`,
    '',
    result,
    '',
    "GitHub Actions opened this PR, and its token can't start CI: add the `run-ci` label, " +
      'then merge once `CI gate` passes.',
  ].join('\n');
}

async function openPullRequest(): Promise<number | null> {
  const owner = repo().split('/')[0];
  const pulls = await github(
    'GET',
    `/repos/${repo()}/pulls?state=open&base=${base()}&head=${owner}:${branch()}`,
  );
  return pulls.length > 0 ? pulls[0].number : null;
}

async function prepare() {
  const latest = git('ls-remote', ADVISORY_DB, 'HEAD').split('\t')[0];
  const pr = await openPullRequest();

  // The base's pin is what the PR moves from. The bump builds on the open
  // PR's branch when there is one, so its earlier commits stay.
  git('fetch', '--depth', '1', 'origin', base());
  const pinned = git('show', `FETCH_HEAD:${revFile()}`);
  if (pr !== null) {
    git('fetch', '--depth', '1', 'origin', branch());
  }
  git('checkout', '-B', branch(), 'FETCH_HEAD');

  if (readFileSync(revFile(), 'utf8').trim() === latest) {
    console.log(`The pin is already at ${short(latest)}.`);
    output({ changed: 'false' });
    return;
  }

  writeFileSync(revFile(), `${latest}\n`);
  console.log(`Moving the pin from ${short(pinned)} to ${short(latest)}.`);
  output({ changed: 'true', from: pinned, to: latest, pr: pr === null ? '' : String(pr) });
}

async function publish() {
  const from = env('PIN_FROM');
  const to = env('PIN_TO');
  const pr = process.env.PR_NUMBER;

  git('-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`, 'commit', '-m', title(to), '--', revFile());

  // A closed PR can leave the branch behind. Delete it rather than force-push
  // over it: GitHub refuses an Actions-token push that would carry the base's
  // workflow changes onto an existing branch.
  if (!pr && git('ls-remote', '--heads', 'origin', branch()) !== '') {
    git('push', 'origin', '--delete', branch());
  }
  git('push', 'origin', `HEAD:refs/heads/${branch()}`);

  // Pushes made with the Actions token start no workflow, so the required
  // `cla` status never arrives from the CLA workflow (`cla.rs`). Set it as that
  // workflow would for this PR's bot author. A person's push to the branch runs
  // the CLA workflow itself.
  await github('POST', `/repos/${repo()}/statuses/${git('rev-parse', 'HEAD')}`, {
    state: 'success',
    context: 'cla',
    description: 'bot account — CLA not required',
  });

  const body = description(from, to, env('DENY_OUTCOME'), env('RUN_URL'));
  if (pr) {
    await github('PATCH', `/repos/${repo()}/pulls/${pr}`, { title: title(to), body });
    console.log(`Updated #${pr}.`);
    return;
  }

  const created = await github('POST', `/repos/${repo()}/pulls`, {
    title: title(to),
    head: branch(),
    base: base(),
    body,
  });
  console.log(`Opened ${created.html_url}.`);
}

export async function main() {
  const modes: Record<string, () => Promise<void>> = { prepare, publish };
  const mode = modes[env('BUMP_MODE')];
  if (!mode) {
    throw new Error(`unknown BUMP_MODE ${process.env.BUMP_MODE}`);
  }
  await mode();
}

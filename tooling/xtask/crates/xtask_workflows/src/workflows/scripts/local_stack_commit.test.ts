import assert from 'node:assert/strict';
import { test } from 'node:test';

import { builtBinaries, type Job, pick, type Run, WARM_JOB } from './local_stack_commit.ts';

const done = (name: string, conclusion = 'success'): Job => ({ name, status: 'completed', conclusion });
const build = (service: string) => `Deploy Cloud Storage Services / Build ${service} binaries`;

test('a run counts once the shared deps and every binary build passed', () => {
  const jobs = [done(WARM_JOB), done(build('a')), done(build('b'))];
  assert.equal(builtBinaries(jobs), true);
  // Later jobs (deploys, lambdas) don't matter, so a run still deploying counts.
  assert.equal(
    builtBinaries([...jobs, { name: 'Deploy Cloud Storage Services / Deploy a', status: 'queued', conclusion: null }]),
    true,
  );
  assert.equal(builtBinaries([...jobs, done(build('c'), 'failure')]), false);
  assert.equal(builtBinaries([...jobs, { name: build('c'), status: 'in_progress', conclusion: null }]), false);
  assert.equal(builtBinaries([done(build('a'))]), false);
  // A run cancelled while waiting has no build jobs.
  assert.equal(builtBinaries([done(WARM_JOB)]), false);
  assert.equal(builtBinaries([]), false);
  assert.equal(builtBinaries([done(WARM_JOB, 'cancelled'), done(build('a'))]), false);
});

test('picks the newest run that built its binaries', async () => {
  const runs: Run[] = [
    { id: 3, head_sha: 'c' },
    { id: 2, head_sha: 'b' },
    { id: 1, head_sha: 'a' },
  ];
  const jobs: Record<number, Job[]> = {
    3: [],
    2: [done(WARM_JOB), done(build('x'))],
    1: [done(WARM_JOB), done(build('x'))],
  };
  assert.equal((await pick(runs, async (run) => jobs[run.id]))?.head_sha, 'b');
  assert.equal(await pick(runs, async () => []), undefined);
});

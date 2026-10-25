const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const script = new AsyncFunction('github', 'context', 'core', 'process',
  readFileSync(`${__dirname}/ios_native_check_comment.js`, 'utf8'));
const marker = '<!-- ios-native-check-status -->';

async function run({ steps, comments = [], head = 'current', state = 'open', labels = [] }) {
  const writes = [];
  const summaries = [];
  const github = {
    rest: {
      pulls: { get: async () => ({ data: { state, head: { sha: head }, labels } }) },
      issues: {
        listComments() {},
        createComment: async (value) => writes.push({ type: 'create', ...value }),
        updateComment: async (value) => writes.push({ type: 'update', ...value }),
      },
    },
    paginate: async () => comments,
  };
  const core = { summary: { addRaw(body) { summaries.push(body); return this; }, async write() {} } };
  await script(github, {
    repo: { owner: 'macro-inc', repo: 'macro' }, issue: { number: 123 },
    payload: { pull_request: { head: { sha: 'current' } } },
    serverUrl: 'https://github.com', runId: 456,
  }, core, { env: { IOS_GATE_STEPS: JSON.stringify(steps), GITHUB_RUN_ATTEMPT: '2' } });
  return { writes, summaries };
}
const native = { 'native-filter': { outputs: { ios_native: 'true' } } };
const release = { version: '2.0.10', build: '188', floor: 185, distributionUrl: 'https://example.test/app' };

test('expected release requirement includes instructions and the committed floor', async () => {
  const { writes, summaries } = await run({ steps: { ...native,
    live: { outcome: 'failure', outputs: { gate_result: JSON.stringify({ ...release,
      kind: 'release-required', reason: 'Version has not been created.' }) } },
  } });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, 'create');
  assert.match(writes[0].body, /2\.0\.10 \(build 188\) must be live/);
  assert.match(writes[0].body, /add \*\*`ios-update`\*\*/);
  assert.match(writes[0].body, /build \*\*185\*\*/);
  assert.match(writes[0].body, /runs\/456\/attempts\/2/);
  assert.equal(summaries.length, 1);
});

test('infrastructure failures never claim that the release is missing', async () => {
  for (const id of ['checkout', 'bun', 'credentials', 'live', 'bump']) {
    const { writes } = await run({ steps: { ...native, [id]: { outcome: 'failure' } } });
    assert.match(writes[0].body, /could not complete/);
    assert.match(writes[0].body, /does not establish whether/);
    assert.doesNotMatch(writes[0].body, /must be live before/);
  }
});

test('waiting and live results update the existing bot comment', async () => {
  for (const kind of ['waiting', 'live']) {
    const { writes } = await run({ comments: [{ id: 99, user: { login: 'github-actions[bot]' }, body: marker }],
      steps: { ...native, live: { outcome: kind === 'live' ? 'success' : 'failure', outputs: {
        gate_result: JSON.stringify({ ...release, kind, reason: 'In review.', state: 'IN_REVIEW' }),
      } } },
    });
    assert.equal(writes[0].type, 'update');
    assert.equal(writes[0].comment_id, 99);
    assert.match(writes[0].body, kind === 'live' ? /live and verified/ : /Wait for Apple/);
  }
});

test('manual release and mismatched build need action rather than waiting', async () => {
  const waiting = await run({ steps: { ...native, live: { outputs: { gate_result: JSON.stringify({
    ...release, kind: 'waiting', state: 'PENDING_DEVELOPER_RELEASE', reason: 'Approved.',
  }) } } } });
  assert.match(waiting.writes[0].body, /Release the approved version in App Store Connect/);
  const mismatch = await run({ steps: { ...native, live: { outputs: { gate_result: JSON.stringify({
    ...release, kind: 'mismatch', reason: 'Wrong native tree.',
  }) } } } });
  assert.match(mismatch.writes[0].body, /Bump the release numbers/);
  assert.match(mismatch.writes[0].body, /--no-min/);
});

test('ignore stale runs and closed PRs', async () => {
  for (const options of [{ head: 'newer' }, { state: 'closed' }]) {
    assert.equal((await run({ steps: native, ...options })).writes.length, 0);
  }
});

test('web-only PRs stay quiet and resolved native changes update old comments', async () => {
  assert.equal((await run({ steps: {} })).writes.length, 0);
  const { writes } = await run({ steps: {
    'native-filter': { outcome: 'success', outputs: { ios_native: 'false' } },
    'cache-wasm': { outcome: 'success', outputs: { bumped: 'false' } },
  }, comments: [{ id: 99,
    user: { login: 'github-actions[bot]' }, body: marker }] });
  assert.equal(writes[0].type, 'update');
  assert.match(writes[0].body, /no longer changes native/);
});

test('never edit a human comment that copies the marker', async () => {
  const { writes } = await run({ steps: { ...native, live: { outcome: 'failure' } },
    comments: [{ id: 77, user: { login: 'human' }, body: marker }] });
  assert.equal(writes[0].type, 'create');
});

test('skip label reports a bypass without claiming verification', async () => {
  const { writes } = await run({ steps: { ...native, labels: { outputs: { skip: 'true' } } } });
  assert.match(writes[0].body, /gate bypassed/);
  assert.match(writes[0].body, /has not been verified/);
});

test('failed checkout cannot overwrite an existing comment with a non-native conclusion', async () => {
  const comments = [{ id: 99, user: { login: 'github-actions[bot]' }, body: marker }];
  const { writes } = await run({ steps: { checkout: { outcome: 'failure' } }, comments });
  assert.match(writes[0].body, /could not complete/);
  assert.doesNotMatch(writes[0].body, /no longer changes native/);
  const unknown = await run({ steps: {}, comments });
  assert.match(unknown.writes[0].body, /status unavailable/);
});

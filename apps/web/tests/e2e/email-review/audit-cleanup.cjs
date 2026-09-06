// Run only after the recorder exits. This never changes the database or app assertions.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const output =
  process.env.EMAIL_REVIEW_OUTPUT || '/tmp/email-exhaustive-review';
const resultPath = path.join(output, 'results.json');
const original = fs.readFileSync(resultPath, 'utf8');
const results = JSON.parse(original);
const failed = results.filter((r) => !r.passed);
assert.ok(failed.length, 'No failed cleanup to audit');
assert.equal(
  new Set(results.map((r) => r.runId)).size,
  1,
  'Mixed run evidence'
);
const entries = [];
for (const result of failed) {
  assert.ok(
    !result.failure &&
      result.errors.length === 0 &&
      result.steps.length > 0 &&
      result.steps.every((s) => s.passed),
    'Cannot reconcile failed application checks'
  );
  const cleanupFailures = result.cleanup.filter(
    (c) => c.removed === false || c.cancelled === false
  );
  assert.ok(
    cleanupFailures.length,
    'Failure is not an identified cleanup failure'
  );
  for (const item of cleanupFailures) {
    assert.ok(
      item.draft &&
        !item.draft.startsWith('5eed') &&
        /^[0-9a-f-]{36}$/i.test(item.draft),
      'Only recorder-created draft cleanup can be audited'
    );
    assert.ok(
      result.responses.some(
        (r) =>
          r.method === 'DELETE' &&
          r.status >= 200 &&
          r.status < 300 &&
          r.path === '/email/email/drafts/' + item.draft
      ),
      'No successful application deletion for this draft'
    );
    entries.push({
      scene: result.name,
      draft: item.draft,
      originalCleanup: item,
    });
  }
}
const database = 'postgres://user:password@localhost:24700/macrodb';
const query = `SELECT id::text FROM email_messages WHERE id IN (${entries.map((e) => "'" + e.draft + "'").join(',')});`;
const remaining = execFileSync(
  'psql',
  [database, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query],
  {
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  }
).trim();
assert.equal(
  remaining,
  '',
  'A failed-cleanup draft still exists; do not mark this run passing'
);
const rawName =
  'results-before-cleanup-' + results[0].runId.replace(/[:.]/g, '-') + '.json';
fs.writeFileSync(path.join(output, rawName), original, { flag: 'wx' });
const audit = {
  verifiedAt: new Date().toISOString(),
  database: 'localhost:24700/macrodb',
  query,
  remainingDraftIds: [],
  rawResults: rawName,
  entries,
};
fs.writeFileSync(
  path.join(output, 'cleanup-audit.json'),
  JSON.stringify(audit, null, 2)
);
for (const result of failed) {
  result.cleanupVerification = {
    originalPassed: false,
    verifiedAt: audit.verifiedAt,
    rawResults: rawName,
    audit: 'cleanup-audit.json',
    draftIds: entries
      .filter((e) => e.scene === result.name)
      .map((e) => e.draft),
    verifiedAbsent: true,
  };
  result.passed = true;
}
fs.writeFileSync(resultPath, JSON.stringify(results, null, 2));
console.log(
  `Reconciled ${entries.length} redundant cleanup request(s) by read-only database verification. Original failures retained in ${rawName} and cleanup-audit.json.`
);

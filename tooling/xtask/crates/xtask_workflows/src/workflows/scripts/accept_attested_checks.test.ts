// Which attested checks a run's path-check accepts. Run by xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { acceptedChecks, inputsDigest } from './accept_attested_checks.ts';

const CHECKS = {
  'cloud-storage/check': ['query_data', 'rust_packages', 'should_run'],
  'cloud-storage/graphql-schema-compat': ['graphql_schema', 'should_run'],
};
const OUTPUTS = {
  should_run: 'true',
  query_data: 'false',
  rust_packages: 'email documents',
  graphql_schema: 'false',
};

describe('inputsDigest', () => {
  test('is the digest cargo x attest computes for the same outputs', () => {
    // sha256 of "rust_packages=email documents\nshould_run=true\n", 16 hex digits.
    assert.equal(
      inputsDigest({ should_run: 'true', rust_packages: 'email documents' }),
      '705c3b0a1adf4955',
    );
  });

  test('does not depend on the order the outputs are given in', () => {
    assert.equal(inputsDigest({ a: '1', b: '2' }), inputsDigest({ b: '2', a: '1' }));
  });
});

describe('acceptedChecks', () => {
  const digest = inputsDigest({
    query_data: 'false',
    rust_packages: 'email documents',
    should_run: 'true',
  });

  test('accepts a check attested on the outputs this run computed', () => {
    assert.deepEqual(acceptedChecks([`cloud-storage/check@${digest}`], CHECKS, OUTPUTS), [
      'cloud-storage/check',
    ]);
  });

  test('drops a check attested on another package selection', () => {
    const outputs = { ...OUTPUTS, rust_packages: 'email documents soup' };

    assert.deepEqual(acceptedChecks([`cloud-storage/check@${digest}`], CHECKS, outputs), []);
  });

  test("drops another check's digest", () => {
    assert.deepEqual(
      acceptedChecks([`cloud-storage/graphql-schema-compat@${digest}`], CHECKS, OUTPUTS),
      [],
    );
  });

  test('reads an output this run did not set as empty', () => {
    const empty = inputsDigest({ graphql_schema: '', should_run: '' });

    assert.deepEqual(
      acceptedChecks([`cloud-storage/graphql-schema-compat@${empty}`], CHECKS, {}),
      ['cloud-storage/graphql-schema-compat'],
    );
  });
});

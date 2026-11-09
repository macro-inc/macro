import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { oracleCases } from './oracle-cases';
import { validateCandidateReport } from './oracle-report';

const source = '/upstream';
const candidate = {
  success: true,
  numTotalTests: 275,
  numPassedTests: 275,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numTotalTestSuites: 7,
  numPassedTestSuites: 7,
  numFailedTestSuites: 0,
  numPendingTestSuites: 0,
  testResults: oracleCases.map((spec) => ({
    name: resolve(source, spec.file),
    status: 'passed',
    assertionResults: Array.from({ length: spec.cases }, (_, index) => ({
      status: 'passed',
      fullName: `node case ${index}`,
      title: `case ${index}`,
      ancestorTitles: [],
      duration: 1,
      failureMessages: [],
    })),
  })),
};

test('complete passing reports are candidates without asserting native identity', () => {
  expect(() => validateCandidateReport(candidate, source)).not.toThrow();
});

test.each(['skipped', 'pending', 'todo', 'failed', 'unknown'])(
  'rejects a %s assertion even when exit counts claim success',
  (status) => {
    const report = structuredClone(candidate);
    report.testResults[0].assertionResults[0].status = status;
    expect(() => validateCandidateReport(report, source)).toThrow(
      'non-passing assertions'
    );
  }
);

test('rejects incomplete suites and contradictory summary counts', () => {
  const report = structuredClone(candidate);
  report.testResults[0].assertionResults.pop();
  expect(() => validateCandidateReport(report, source)).toThrow('incomplete');
  expect(() =>
    validateCandidateReport({ ...candidate, numPendingTests: 1 }, source)
  ).toThrow();
  expect(() =>
    validateCandidateReport({ ...candidate, success: false }, source)
  ).toThrow();
});

test('rejects malformed assertion records and missing required suites', () => {
  const report = structuredClone(candidate);
  report.testResults[0].assertionResults[0].fullName = '';
  expect(() => validateCandidateReport(report, source)).toThrow('malformed');
  expect(() =>
    validateCandidateReport(
      { ...candidate, testResults: [null, ...candidate.testResults.slice(1)] },
      source
    )
  ).toThrow('incomplete');
  expect(() => validateCandidateReport(null, source)).toThrow();
});

import { resolve } from 'node:path';
import { oracleCases } from './oracle-cases';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateCandidateReport(result: unknown, source: string): void {
  const expected = oracleCases.reduce((count, spec) => count + spec.cases, 0);
  if (
    !isRecord(result) ||
    result.success !== true ||
    result.numTotalTests !== expected ||
    result.numPassedTests !== expected ||
    result.numFailedTests !== 0 ||
    result.numPendingTests !== 0 ||
    result.numTodoTests !== 0 ||
    result.numFailedTestSuites !== 0 ||
    result.numPendingTestSuites !== 0 ||
    typeof result.numTotalTestSuites !== 'number' ||
    !Number.isSafeInteger(result.numTotalTestSuites) ||
    result.numTotalTestSuites < oracleCases.length ||
    result.numPassedTestSuites !== result.numTotalTestSuites ||
    !Array.isArray(result.testResults) ||
    result.testResults.length !== oracleCases.length
  )
    throw new Error('Incomplete or non-passing node oracle report');
  const suites: unknown[] = result.testResults;
  for (const spec of oracleCases) {
    const suite = suites.find(
      (entry) => isRecord(entry) && entry.name === resolve(source, spec.file)
    );
    if (
      !isRecord(suite) ||
      suite.status !== 'passed' ||
      !Array.isArray(suite.assertionResults) ||
      suite.assertionResults.length !== spec.cases
    ) {
      throw new Error(`Node oracle suite is incomplete: ${spec.file}`);
    }
    const assertions: unknown[] = suite.assertionResults;
    for (const entry of assertions) {
      if (
        !isRecord(entry) ||
        entry.status !== 'passed' ||
        typeof entry.fullName !== 'string' ||
        entry.fullName.length === 0 ||
        typeof entry.title !== 'string' ||
        entry.title.length === 0 ||
        !Array.isArray(entry.ancestorTitles) ||
        !entry.ancestorTitles.every((title) => typeof title === 'string') ||
        typeof entry.duration !== 'number' ||
        !Number.isFinite(entry.duration) ||
        entry.duration < 0 ||
        !Array.isArray(entry.failureMessages) ||
        entry.failureMessages.length !== 0
      ) {
        throw new Error(
          `Node oracle suite has malformed or non-passing assertions: ${spec.file}`
        );
      }
    }
  }
}

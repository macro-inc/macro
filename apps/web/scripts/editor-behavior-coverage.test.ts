import { describe, expect, it } from 'vitest';
import { exactCaseStatus, mergeOffReports } from './editor-behavior-coverage';

describe('behavior result evidence', () => {
  it('keeps overlapping reports ambiguous instead of hiding a retry', () => {
    const report = {
      testResults: [
        {
          name: '/workspace/test.ts',
          assertionResults: [{ fullName: 'behavior', status: 'passed' }],
        },
      ],
    };
    expect(
      exactCaseStatus(
        mergeOffReports([report, report]),
        'test.ts',
        'behavior',
        '/workspace'
      )
    ).toBe('OFF unverified; ON pending');
  });

  it('rejects malformed evidence in any supplied report', () => {
    expect(() =>
      mergeOffReports([{ testResults: [] }, { testResults: 'invalid' }])
    ).toThrow();
  });

  it('matches the exact test file and selector before accepting a pass', () => {
    const results = {
      testResults: [
        {
          name: '/workspace/wrong.test.ts',
          assertionResults: [{ fullName: 'behavior', status: 'passed' }],
        },
        {
          name: '/workspace/correct.test.ts',
          assertionResults: [{ fullName: 'behavior', status: 'failed' }],
        },
      ],
    };
    expect(
      exactCaseStatus(results, 'correct.test.ts', 'behavior', '/workspace')
    ).toBe('OFF failed; ON pending');
    expect(
      exactCaseStatus(
        results,
        'correct.test.ts',
        'other behavior',
        '/workspace'
      )
    ).toBe('OFF unverified; ON pending');
  });

  it.each(['skipped', 'pending', 'todo'])(
    'does not accept a %s test as coverage',
    (status) => {
      const results = {
        testResults: [
          {
            name: '/workspace/test.ts',
            assertionResults: [{ fullName: 'behavior', status }],
          },
        ],
      };
      expect(
        exactCaseStatus(results, 'test.ts', 'behavior', '/workspace')
      ).toBe('OFF unverified; ON pending');
    }
  );

  it('rejects duplicate selectors and accepts a single passing result', () => {
    const test = { fullName: 'behavior', status: 'passed' };
    const file = { name: '/workspace/test.ts', assertionResults: [test] };
    expect(
      exactCaseStatus(
        { testResults: [file] },
        'test.ts',
        'behavior',
        '/workspace'
      )
    ).toBe('OFF pass; ON pending');
    expect(
      exactCaseStatus(
        { testResults: [file, file] },
        'test.ts',
        'behavior',
        '/workspace'
      )
    ).toBe('OFF unverified; ON pending');
  });
});

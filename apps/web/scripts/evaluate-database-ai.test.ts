import { describe, expect, test } from 'vitest';
import type { ExecOutcome } from '../src/lib/service-clients/service-storage/databases';
import {
  assertStableReads,
  configuration,
  evaluationError,
  localOrigin,
} from './evaluate-database-ai';

describe('database AI evaluation safeguards', () => {
  test('omits authenticated request headers from transport failures', () => {
    const error = new Error('apiRequestContext.fetch: connect ECONNREFUSED\nCall log:\n  cookie: private-session\n  authorization: Bearer private-token');
    expect(evaluationError(error)).toBe('apiRequestContext.fetch: connect ECONNREFUSED');
  });
  test('requires explicit flags for seeding and model calls independently', () => {
    expect(configuration([], {}).run).toBe(false);
    expect(configuration([], {}).seed).toBe(false);
    expect(configuration(['--seed'], {})).toMatchObject({
      seed: true,
      run: false,
    });
    expect(configuration(['--run'], {})).toMatchObject({
      seed: false,
      run: true,
    });
    expect(configuration(['--seed', '--run'], {})).toMatchObject({
      seed: true,
      run: true,
    });
    expect(configuration(['--seed', '--run', '--help'], {})).toMatchObject({
      seed: false,
      run: false,
    });
    expect(() =>
      configuration(['--seed'], {
        DATABASE_AI_EVAL_BACKEND_URL: 'https://dev.macro.com',
      })
    ).toThrow();
    expect(() =>
      configuration(['--run', '--case', 'not-a-test'], {})
    ).toThrow();
    expect(() => configuration(['--output', '--run'], {})).toThrow();
    expect(() =>
      configuration(['--output', '/home/wolf/report.json'], {})
    ).toThrow();
  });

  test('rejects remote endpoints and URLs containing credentials', () => {
    for (const origin of [
      'https://dev.macro.com',
      'https://localhost.example.com',
      'http://localtest.me',
      'file:///tmp/example',
      'http://user:password@localhost:21709',
      'http://localhost:21709/dss',
      'http://localhost:21709/?token=secret',
    ]) {
      expect(() => localOrigin(origin)).toThrow();
    }
  });

  test('accepts only explicit local HTTP origins', () => {
    for (const origin of [
      'http://localhost:9334',
      'http://127.0.0.1:21709',
      'http://[::1]:21709',
      'http://database-ui.localhost:21710',
    ]) {
      expect(localOrigin(origin)).toBe(origin);
    }
  });

  test('requires live table dependencies and stable SQL aliases', () => {
    const tableId = '019a0000-0000-7000-8000-000000000001';
    const answer: ExecOutcome = {
      results: [
        {
          columns: [{ name: 'count', entity_type: null, origin: null }],
          rows: [[12]],
        },
      ],
      changes_applied: 0,
      inserted_row_ids: [],
      new_versions: {},
      read_tables: [tableId],
      read_versions: { [tableId]: 2 },
      truncated_tables: [],
    };
    const sql = `SELECT COUNT(*) FROM "_macro_table_${tableId.replaceAll('-', '')}"`;
    expect(() => assertStableReads(sql, answer)).not.toThrow();
    expect(() =>
      assertStableReads('SELECT COUNT(*) FROM tickets', answer)
    ).toThrow();
    expect(() =>
      assertStableReads('SELECT 12', { ...answer, read_tables: [] })
    ).toThrow();
    expect(() =>
      assertStableReads(sql, { ...answer, changes_applied: 1 })
    ).toThrow();
    expect(() =>
      assertStableReads(sql, { ...answer, truncated_tables: ['tickets'] })
    ).toThrow();
  });
});

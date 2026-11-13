import { ThrownResultError } from '@core/util/result';
import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { dashboard } from '../tests/fake-dashboard';
import {
  dashboardFailure,
  fetchDashboard,
  fetchHomeDashboard,
} from './dashboard-client';

describe('dashboard client', () => {
  it("reads an account's home dashboard from its encoded path", async () => {
    const urls: string[] = [];
    const result = await fetchHomeDashboard(
      'macro|agent@example.com',
      async (url) => {
        urls.push(url);
        return ok(dashboard());
      }
    );

    expect(result._unsafeUnwrap()).toEqual(dashboard());
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(
      /\/dashboards\/home\/macro%7Cagent%40example\.com$/
    );
  });

  it('rejects a body that is not a dashboard', async () => {
    const result = await fetchDashboard('d1', async () =>
      ok({ id: 'd1', view: 'not a view' })
    );

    expect(result._unsafeUnwrapErr()).toEqual([
      { code: 'INVALID_JSON', message: 'Unexpected dashboard' },
    ]);
  });

  it('passes transport errors through', async () => {
    const result = await fetchDashboard('d1', async () =>
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );

    expect(result._unsafeUnwrapErr()[0]?.code).toBe('NOT_FOUND');
  });
});

describe('dashboardFailure', () => {
  it('maps response codes to the failures the page shows', () => {
    const thrown = (code: string) =>
      new ThrownResultError([{ code, message: code }]);

    expect(dashboardFailure(thrown('NOT_FOUND'))).toBe('missing');
    expect(dashboardFailure(thrown('FORBIDDEN'))).toBe('forbidden');
    expect(dashboardFailure(thrown('SERVER_ERROR'))).toBe('failed');
    expect(dashboardFailure(new Error('offline'))).toBe('failed');
  });
});

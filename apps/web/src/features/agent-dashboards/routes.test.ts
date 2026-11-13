import { appRoutesManifest } from '@app/features/agent-navigation/tests/app-routes';
import { decodePane, decodeSegment } from '@app/lib/split-router';
import { describe, expect, it } from 'vitest';

function decode(path: string) {
  const route = decodePane(
    appRoutesManifest(),
    path.split('/').filter(Boolean).map(decodeSegment)
  );
  return route?.matches.at(-1);
}

describe('dashboard routes', () => {
  it('opens a dashboard by id at the path the SDK links to', () => {
    expect(decode('/dashboard/0190f5a4-0000-7000-8000-000000000009')).toEqual({
      id: 'dashboard',
      params: { dashboardId: '0190f5a4-0000-7000-8000-000000000009' },
    });
  });

  it("opens an agent account's page by its Macro id", () => {
    expect(decode('/agent-accounts/macro%7Cagent%40example.com')).toEqual({
      id: 'agent-dashboard',
      params: { userId: 'macro|agent@example.com' },
    });
  });

  it('leaves legacy agent session links alone', () => {
    expect(decode('/agent/0190f5a4-0000-7000-8000-000000000001')?.id).toBe(
      'legacy-content'
    );
  });
});

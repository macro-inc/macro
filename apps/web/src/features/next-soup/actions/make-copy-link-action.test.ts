import type { EntityData } from '@entity';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn() },
}));
vi.mock('../utils', () => ({
  calendarEventLinkTarget: vi.fn(),
}));

import { makeCopyLinkAction } from './make-copy-link-action';

afterEach(() => vi.unstubAllGlobals());

describe('makeCopyLinkAction', () => {
  it('copies a Reviews detail URL for a GitHub pull request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    });
    const pr = {
      type: 'foreign',
      foreignSource: 'github_pull_request',
      id: 'pr-1',
      metadata: { url: 'https://github.com/macro/repo/pull/1' },
    } as unknown as EntityData;

    await makeCopyLinkAction().execute([pr]);

    const copied = new URL(writeText.mock.calls[0]![0] as string);
    expect(copied.pathname).toBe('/app/reviews/pr/pr-1');
  });
});

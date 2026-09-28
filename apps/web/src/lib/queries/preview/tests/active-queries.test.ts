import { describe, expect, it, vi } from 'vitest';
import {
  refreshActiveGraphqlPreviewQueries,
  registerActiveGraphqlPreviewQuery,
} from '../active-queries';

describe('active GraphQL preview queries', () => {
  it('refreshes only enabled matching previews', async () => {
    const matchingRefresh = vi.fn(async () => undefined);
    const otherRefresh = vi.fn(async () => undefined);
    const disabledRefresh = vi.fn(async () => undefined);
    const unregisterMatching = registerActiveGraphqlPreviewQuery({
      itemId: () => 'doc-1',
      isEnabled: () => true,
      refresh: matchingRefresh,
    });
    const unregisterOther = registerActiveGraphqlPreviewQuery({
      itemId: () => 'doc-2',
      isEnabled: () => true,
      refresh: otherRefresh,
    });
    const unregisterDisabled = registerActiveGraphqlPreviewQuery({
      itemId: () => 'doc-1',
      isEnabled: () => false,
      refresh: disabledRefresh,
    });

    await refreshActiveGraphqlPreviewQueries('doc-1');

    expect(matchingRefresh).toHaveBeenCalledOnce();
    expect(otherRefresh).not.toHaveBeenCalled();
    expect(disabledRefresh).not.toHaveBeenCalled();

    unregisterMatching();
    unregisterOther();
    unregisterDisabled();
  });
});

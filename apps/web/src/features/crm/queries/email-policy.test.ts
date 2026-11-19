import type { PreviewItem } from '@queries/preview';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createThreadRuleName } from './email-policy';

const graphql = vi.hoisted(() => vi.fn());
const fullPreview = vi.hoisted(() => vi.fn());
vi.mock('@queries/preview/graphql', () => ({
  createGraphqlItemPreviewQuery: graphql,
}));
vi.mock('@queries/preview', () => ({ useItemRawName: fullPreview }));

it('keeps unavailable thread labels empty without loading the full thread', () => {
  createRoot((dispose) => {
    const [data, setData] = createSignal<PreviewItem>();
    graphql.mockReturnValue({ data, shouldFallback: () => true });
    const name = createThreadRuleName('thread');
    expect(name()).toBeUndefined();
    setData({ id: 'thread', type: 'email', loading: true });
    expect(name()).toBeUndefined();
    setData({
      id: 'thread',
      type: 'email',
      access: 'access',
      loading: false,
      name: 'Example conversation',
      rawName: 'Example conversation',
    });
    expect(name()).toBe('Example conversation');
    setData({
      id: 'thread',
      type: 'email',
      access: 'no_access',
      loading: false,
    });
    expect(name()).toBeUndefined();
    expect(fullPreview).not.toHaveBeenCalled();
    dispose();
  });
});

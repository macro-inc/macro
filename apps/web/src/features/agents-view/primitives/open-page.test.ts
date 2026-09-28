import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { describe, expect, it, vi } from 'vitest';
import { openAgentsPage } from './open-page';

describe('openAgentsPage', () => {
  it('requests Connections again when the workspace is already open on another page', () => {
    let content: SplitContent = { type: 'component', id: 'agents' };
    const replace = vi.fn(({ next }: { next: SplitContent }) => {
      content = next;
    });
    const openWithSplit = vi.fn(() => ({
      status: 'reused',
      owner: 'agents',
      split: { content: () => content, replace },
    }));
    // Only the navigation handle's content and replace capabilities are exercised.
    const layout = { openWithSplit } as unknown as Parameters<
      typeof openAgentsPage
    >[0];
    openAgentsPage(layout, 'connections');
    const first = content;
    openAgentsPage(layout, 'connections');
    expect(replace).toHaveBeenCalledTimes(2);
    expect(content).not.toEqual(first);
    expect(content).toMatchObject({
      id: 'agents',
      params: { agentPage: 'connections' },
    });
  });

  it('allows navigation to be intercepted', () => {
    expect(() =>
      openAgentsPage(
        { openWithSplit: () => ({ status: 'unavailable' }) },
        'connections'
      )
    ).not.toThrow();
  });
});

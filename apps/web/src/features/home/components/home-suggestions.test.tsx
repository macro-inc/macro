import type { RecommendedItem } from '@queries/ai/homeRecommendations';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeSuggestions } from './home-suggestions';

afterEach(cleanup);

const items: RecommendedItem[] = [1, 2, 3, 4].map((id) => ({
  entityType: 'email_thread',
  entityId: `email-${id}`,
  title: `Email subject ${id}`,
  source: 'Email',
  action: 'reply_now',
  reason: `Confirm the requested deadline ${id}`,
  prompt: `Draft a reply to email ${id}`,
}));

describe('HomeSuggestions', () => {
  it('shows three item names and reasons with separate draft and Open actions', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const view = render(() => (
      <HomeSuggestions
        view={{ kind: 'items', items }}
        onSelect={onSelect}
        onOpen={onOpen}
        onRetry={vi.fn()}
        onConnect={vi.fn()}
      />
    ));

    expect(view.getAllByText('Open')).toHaveLength(3);
    expect(view.queryByText(items[3].reason)).toBeNull();
    expect(view.getByText(items[0].title)).toBeTruthy();
    expect(view.queryByText(items[3].title)).toBeNull();
    fireEvent.click(view.getByText(items[0].reason));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(items[0]);
    expect(onOpen).not.toHaveBeenCalled();

    fireEvent.click(
      view.getByRole('button', {
        name: `Open ${items[1].title} in a new split`,
      })
    );
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(items[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

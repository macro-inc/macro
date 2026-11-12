import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkPreviews } from './LinkPreviews';

const host = vi.hoisted(() => ({
  flag: { enabled: true } as { enabled: boolean; loading?: boolean },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => host.flag,
}));
vi.mock('./context', () => ({
  useMessage: () => () => ({ id: 'message' }),
  useMessageActions: () => ({ onRemoveLinkPreviews: vi.fn() }),
}));

const previews = [
  {
    url: 'https://news.example.com/post',
    title: 'A post',
    description: 'What the post is about.',
  },
];

beforeEach(() => {
  host.flag = { enabled: true };
});
afterEach(cleanup);

describe('LinkPreviews', () => {
  it('shows the cards and the remove control while the flag is on', () => {
    render(() => <LinkPreviews previews={previews} />);

    expect(screen.getByText('A post')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove link previews' })
    ).toBeTruthy();
  });

  it.each([
    ['off', { enabled: false }],
    ['still loading', { enabled: false, loading: true }],
  ])('shows nothing while the flag is %s', (_, flag) => {
    host.flag = flag;
    const { container } = render(() => <LinkPreviews previews={previews} />);

    expect(container.querySelector('[data-message-link-previews]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

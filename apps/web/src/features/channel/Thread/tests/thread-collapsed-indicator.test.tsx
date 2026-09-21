import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadCollapsedIndicator } from '../ThreadCollapsedIndicator';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <div data-testid={`participant-${props.id}`} />
  ),
}));

afterEach(cleanup);

describe('ThreadCollapsedIndicator', () => {
  it('renders participant avatars on the collapsed reply control', () => {
    render(() => (
      <ThreadCollapsedIndicator
        collapsedRepliesCount={1}
        participants={['bot|00000000-0000-0000-0000-00000000c5c5']}
        latestReplyAt="2026-09-21T15:26:00.000Z"
      />
    ));

    expect(screen.getByTitle('Expand thread')).toBeTruthy();
    expect(screen.getByText('1 more reply')).toBeTruthy();
    expect(
      screen.getByTestId('participant-bot|00000000-0000-0000-0000-00000000c5c5')
    ).toBeTruthy();
  });
});

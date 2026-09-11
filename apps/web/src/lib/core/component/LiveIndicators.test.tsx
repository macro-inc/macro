/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@ui', () => {
  const Count = (props: ParentProps) => (
    <div data-testid="avatar-count">{props.children}</div>
  );
  const AvatarGroup = Object.assign(
    (props: ParentProps) => (
      <div data-testid="avatar-group">{props.children}</div>
    ),
    { Count }
  );
  return { AvatarGroup };
});
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderRight: (props: ParentProps) => props.children,
}));
vi.mock('@service-connection/use-track-entity-presence', () => ({
  useEntityPresenceTracking: vi.fn(),
}));
vi.mock('../state/liveIndicators', () => ({
  useUserIndicators: () => () => [],
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'me',
}));
vi.mock('./UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <div data-testid="user-avatar">{props.id}</div>
  ),
}));

const { LiveIndicators } = await import('./LiveIndicators');

describe('LiveIndicators', () => {
  it('omits the current user and caps the stack at three plus overflow', () => {
    const { getAllByTestId, getByTestId } = render(() => (
      <LiveIndicators userIds={['me', 'a', 'b', 'c', 'd']} currentUserId="me" />
    ));
    expect(getAllByTestId('user-avatar').map((el) => el.textContent)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(getByTestId('avatar-count').textContent).toBe('+1');
  });

  it('renders nothing when only the current user is viewing', () => {
    const { container } = render(() => (
      <LiveIndicators userIds={['me']} currentUserId="me" />
    ));
    expect(container.textContent).toBe('');
  });
});

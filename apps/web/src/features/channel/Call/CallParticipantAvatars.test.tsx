import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CallParticipantAvatars } from './CallParticipantAvatars';

vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => <img alt={props.id} />,
}));
afterEach(cleanup);

it('shows all four people when they fit, and counts everyone after the first three when overflowing', () => {
  const [ids, setIds] = createSignal(['self', 'alice', 'bob', 'carol']);
  render(() => <CallParticipantAvatars ids={ids()} />);
  expect(screen.getAllByRole('img')).toHaveLength(4);
  expect(screen.queryByText(/^\+/)).toBeNull();

  setIds(['self', 'alice', 'bob', 'carol', 'dan']);
  expect(screen.getAllByRole('img')).toHaveLength(4);
  expect(
    screen.getByText('+2').parentElement?.contains(screen.getByAltText('carol'))
  ).toBe(true);
  expect(screen.queryByAltText('dan')).toBeNull();

  setIds(['self', 'alice', 'bob', 'carol', 'dan', 'erin', 'frank']);
  expect(screen.getByText('+4')).toBeTruthy();
  setIds(['self', 'alice']);
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(screen.queryByText(/^\+/)).toBeNull();
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InCallPreview, JoinCallPreview } from './CallsPreview';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }));
vi.mock('../views/meeting-invite', () => ({
  MeetingInvite: () => <button>Invite Teammates preview</button>,
}));

vi.mock('@channel/Call/CallContext', () => ({
  CallStateProvider: (props: ParentProps) => props.children,
}));
vi.mock('@channel/Call/CallOverlay', () => ({
  CallOverlay: (props: { onLeave: () => void }) => (
    <button onClick={props.onLeave}>Leave simulated call</button>
  ),
}));
vi.mock('./preview-call-state', () => ({
  createPreviewCallState: () => ({
    isAudioMuted: () => false,
    toggleAudio: async () => {},
  }),
}));
vi.mock('@core/util/dataTransfer', () => ({
  writeClipboardData: async () => true,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('mounts the in-call preview already joined and leaves for Macro', async () => {
  render(() => <InCallPreview />);
  await vi.waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Leave simulated call' })
    ).toBeTruthy()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Leave simulated call' }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/', { replace: true });
  await vi.waitFor(() =>
    expect(screen.getByText('Ready to join?')).toBeTruthy()
  );
});

it('mounts guest joining and enters the simulated call after a name is supplied', async () => {
  render(() => <JoinCallPreview />);
  expect(
    screen
      .getByRole('img', { name: 'Your profile picture' })
      .getAttribute('src')
  ).toBe('/sam.png');
  const join = screen.getByRole('button', {
    name: 'Join call',
  }) as HTMLButtonElement;
  expect(join.disabled).toBe(true);
  fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), {
    target: { value: 'Guest reviewer' },
  });
  fireEvent.click(join);
  await vi.waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Leave simulated call' })
    ).toBeTruthy()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Leave simulated call' }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/', { replace: true });
});

it('shows the creator teammate picker and Start call after signing in to the join preview', () => {
  render(() => <JoinCallPreview />);
  expect(
    screen.queryByRole('button', { name: 'Invite Teammates preview' })
  ).toBeNull();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Signed in' }));
  expect(
    screen.getByRole('button', { name: 'Invite Teammates preview' })
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Start call' })).toBeTruthy();
});

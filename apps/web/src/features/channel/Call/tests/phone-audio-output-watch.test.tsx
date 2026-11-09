/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { type AudioOutputState, PhoneAudioOutput } from '../PhoneAudioOutput';

const mocks = vi.hoisted(() => ({
  callId: (): string => 'first',
  invoke: vi.fn(),
  receive: undefined as ((state: AudioOutputState) => void) | undefined,
}));
vi.mock('../CallContext', () => ({
  useCallContextOptional: () => ({ activeCallId: () => mocks.callId() }),
}));
vi.mock('../native-call-platform', () => ({ isNativeCallEnabled: () => true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/util/platform', async (original) => ({
  ...(await original<object>()),
  isPlatform: (platform: string) => platform === 'ios',
}));
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<object>()),
  invoke: (...args: unknown[]) => mocks.invoke(...args),
  Channel: class {
    constructor(receive: (state: AudioOutputState) => void) {
      mocks.receive = receive;
    }
  },
}));

it('retries a failed watch and never replaces a newer route event with an old fetch', async () => {
  const [callId, setCallId] = createSignal('first');
  mocks.callId = callId;
  let watches = 0;
  let reads = 0;
  let failRead!: (error: Error) => void;
  let finishRead!: (value: { state: AudioOutputState }) => void;
  mocks.invoke.mockImplementation((command: string) => {
    if (command.endsWith('watch_audio_output')) {
      watches++;
      return watches === 1
        ? Promise.reject('temporary failure')
        : Promise.resolve();
    }
    return new Promise<{ state: AudioOutputState }>((resolve, reject) => {
      reads++;
      finishRead = resolve;
      failRead = reject;
    });
  });
  render(() => <PhoneAudioOutput />);
  await waitFor(() => expect(watches).toBe(1));
  await Promise.resolve();
  expect(screen.queryByRole('button', { name: 'Audio output' })).toBeNull();
  setCallId('second');
  await waitFor(() => expect(finishRead).toBeDefined());
  const outputs = [
    { id: 'receiver', label: 'Phone' },
    { id: 'speaker', label: 'Speaker' },
  ];
  mocks.receive?.({ callId: 'second', selectedId: 'speaker', outputs });
  finishRead({ state: { callId: 'second', selectedId: 'receiver', outputs } });
  await Promise.resolve();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Audio output' }), {
    key: 'ArrowDown',
  });
  const speaker = await screen.findByRole('menuitemradio', { name: 'Speaker' });
  expect(watches).toBe(2);
  expect(speaker.getAttribute('aria-checked')).toBe('true');
  expect(
    screen
      .getByRole('menuitemradio', { name: 'Phone' })
      .getAttribute('aria-checked')
  ).toBe('false');
  setCallId('third');
  await waitFor(() => expect(reads).toBe(2));
  mocks.receive?.({ callId: 'third', selectedId: 'speaker', outputs });
  failRead(new Error('delayed fetch failure'));
  await Promise.resolve();
  expect(screen.getByRole('button', { name: 'Audio output' })).toBeTruthy();
});

import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictationController } from '../core/types';
import { DictationButton } from './dictation-controls';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));

function controller(): DictationController {
  return {
    phase: () => 'idle',
    active: () => false,
    volumeHistory: () => [],
    elapsedMs: () => 0,
    limitReached: () => false,
    message: () => '',
    messageTone: () => 'info',
    clearMessage: () => {},
    label: () => 'Start dictation',
    disabled: () => false,
    start: async () => {},
    confirm: async () => {},
    cancel: () => {},
  };
}

beforeEach(() => {
  device.touch = false;
});
afterEach(cleanup);

describe('DictationButton', () => {
  it('offers the microphone on a pointer device within the rollout', () => {
    render(() => <DictationButton dictation={controller()} />);
    expect(
      screen.getByRole('button', { name: 'Start dictation' })
    ).toBeTruthy();
  });

  it.each([['a touch device', () => (device.touch = true)]])(
    'renders nothing on %s',
    (_case, arrange) => {
      arrange();
      const { container } = render(() => (
        <DictationButton dictation={controller()} />
      ));
      expect(container.querySelector('button')).toBeNull();
    }
  );
});

import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { MicrophoneLevelMeter } from './microphone-level-meter';

afterEach(cleanup);

it('follows the input level and reads empty while the mic is off', () => {
  const [level, setLevel] = createSignal(0);
  const [enabled, setEnabled] = createSignal(true);
  render(() => <MicrophoneLevelMeter level={level()} enabled={enabled()} />);
  const meter = screen.getByRole('meter', { name: 'Microphone level' });
  expect(screen.getByText('Speak to test your mic')).toBeTruthy();
  setLevel(0.42);
  expect(meter.getAttribute('aria-valuenow')).toBe('42');
  setEnabled(false);
  expect(meter.getAttribute('aria-valuenow')).toBe('0');
  expect(screen.getByText('Mic is off')).toBeTruthy();
});

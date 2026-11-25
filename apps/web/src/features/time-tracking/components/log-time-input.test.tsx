import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { LogTimeInput, QuickLengths } from './log-time-input';

afterEach(cleanup);

it('names each one-tap length by itself, without a hint that repeats it', () => {
  const onLog = vi.fn();
  render(() => <QuickLengths onLog={onLog} />);

  for (const name of [
    'Log 15m today',
    'Log 30m today',
    'Log 1h today',
    'Log 2h today',
  ]) {
    expect(screen.getByRole('button', { name }).textContent).toBe(name);
  }
  expect(screen.queryByText('Today')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Log 30m today' }));
  expect(onLog).toHaveBeenCalledWith(30);
});

it('keeps the Enter hint beside a typed length', () => {
  render(() => (
    <LogTimeInput today="2026-11-24" onLog={vi.fn()} onCustom={vi.fn()} />
  ));

  fireEvent.input(screen.getByRole('textbox', { name: 'Length to log' }), {
    target: { value: '45m' },
  });
  expect(screen.getByText('Today · Enter').closest('button')?.textContent).toBe(
    'Log 45mToday · Enter'
  );
});

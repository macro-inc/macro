import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { EntryForm } from './entry-form';

const SHORT_TIMER = {
  minutes: 1,
  date: '2026-11-23',
  note: null,
  startedAt: '2026-11-23T20:26:05.000Z',
  endedAt: '2026-11-23T20:26:40.000Z',
};

afterEach(cleanup);

it('keeps an untouched span, even one inside a single minute', () => {
  const onSubmit = vi.fn();
  render(() => (
    <EntryForm
      initial={SHORT_TIMER}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  ));
  fireEvent.input(screen.getByRole('textbox', { name: 'Length' }), {
    target: { value: '5m' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSubmit).toHaveBeenCalledWith({
    date: SHORT_TIMER.date,
    minutes: 5,
    note: null,
    startedAt: SHORT_TIMER.startedAt,
    endedAt: SHORT_TIMER.endedAt,
  });
});

it('still asks an edited span to end after it starts', () => {
  const onSubmit = vi.fn();
  const { container } = render(() => (
    <EntryForm
      initial={SHORT_TIMER}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  ));
  const [start, end] = [...container.querySelectorAll('input[type="time"]')];
  fireEvent.input(start as HTMLInputElement, { target: { value: '10:00' } });
  fireEvent.input(end as HTMLInputElement, { target: { value: '09:00' } });
  expect(
    (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled
  ).toBe(true);
});

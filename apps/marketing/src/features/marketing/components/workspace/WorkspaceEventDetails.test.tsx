import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceEventDetails } from './WorkspaceEventDetails';

afterEach(cleanup);
it('opens an event summary, exposes editing explicitly, and closes with Escape', () => {
  const update = vi.fn();
  const close = vi.fn();
  const view = render(() => (
    <WorkspaceEventDetails
      event={{
        id: 'launch-review',
        title: 'Launch review',
        date: '2026-09-29',
        start: 13,
        duration: 1,
        calendar: 'work',
        description: 'Review the launch plan.',
      }}
      onUpdate={update}
      onClose={close}
    />
  ));
  expect(view.queryByRole('textbox', { name: 'Event title' })).toBeNull();
  expect(view.getByText('4 attendees')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Maybe' }));
  expect(
    view.getByRole('button', { name: 'Maybe' }).getAttribute('aria-pressed')
  ).toBe('true');
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Edit event' }));
  fireEvent.input(view.getByRole('textbox', { name: 'Event title' }), {
    target: { value: 'Launch review — updated' },
  });
  expect(update).toHaveBeenCalledWith({ title: 'Launch review — updated' });
  fireEvent.click(view.getByRole('button', { name: 'Done' }));
  expect(view.queryByRole('textbox', { name: 'Event title' })).toBeNull();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
});

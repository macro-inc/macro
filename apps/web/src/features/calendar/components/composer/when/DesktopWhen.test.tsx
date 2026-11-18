import { installTimeInputResizeObserver } from '@app/components/date-time-range/test-support';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerWhenRoot } from './ComposerWhenRoot';
import { DesktopWhen } from './DesktopWhen';

beforeAll(installTimeInputResizeObserver);
afterEach(cleanup);
it('keeps the editor mounted through typed times, list Escape, and popover dismissal', async () => {
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-13T13:00'), false),
        title: 'Review',
        start: '2030-11-13T13:00',
        end: '2030-11-13T14:00',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerWhenRoot>
          <DesktopWhen />
        </ComposerWhenRoot>
      </ComposerRoot>
    );
  });
  await userEvent.click(screen.getByRole('button', { name: 'When' }));
  const start = screen.getByRole('combobox', { name: 'event start time' });
  await userEvent.clear(start);
  await userEvent.type(start, '3p');
  await userEvent.keyboard('{Enter}');
  expect(controller.state().start).toBe('2030-11-13T15:00');
  expect(controller.state().end).toBe('2030-11-13T16:00');
  expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  await userEvent.click(start);
  await userEvent.clear(start);
  await userEvent.type(start, '5p');
  await userEvent.keyboard('{Escape}');
  expect(controller.state().start).toBe('2030-11-13T15:00');
  await userEvent.keyboard('{Escape}');
  expect(
    screen.queryByRole('combobox', { name: 'event start time' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'When' }).textContent).toContain(
    '3 – 4pm'
  );
});

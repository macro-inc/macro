import { installTimeInputResizeObserver } from '@app/components/date-time-range/test-support';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerWhen } from './ComposerWhen';

beforeAll(installTimeInputResizeObserver);
afterEach(cleanup);
it('preserves a locked end when the start date moves', async () => {
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T10:00'), false),
        title: 'Review',
        start: '2030-01-01T10:00',
        end: '2030-01-01T11:00',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      disabledFields: { end: true },
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerWhen />
      </ComposerRoot>
    );
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit event start date' })
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Go to previous month' })
  );
  const previousDay = screen
    .getAllByRole('gridcell', { name: '31' })
    .find((cell) => !cell.hasAttribute('disabled'));
  if (!previousDay)
    throw new Error('Expected an enabled day before the locked end');
  await userEvent.click(previousDay);
  expect(controller.state().start).toBe('2029-12-31T10:00');
  expect(controller.state().end).toBe('2030-01-01T11:00');
});

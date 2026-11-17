import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../../../components/composer/create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../../../components/composer/event-form-model';
import { ComposerRoot } from '../../../components/composer/root/ComposerRoot';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { MobileComposerWhen } from './MobileComposerWhen';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function setup(
  timeFormat: '12-hour' | '24-hour' = '12-hour',
  thisEvent = false
) {
  let state: ReturnType<typeof createCalendarEventFormController> | undefined;
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T20:00'), false),
        title: 'Review',
        start: '2030-11-11T20:00',
        end: '2030-11-11T21:00',
        calendarId: 'calendar',
      },
      calendarOptions: () => [
        { id: 'calendar', label: 'Calendar', color: 'var(--color-blue-ink)' },
      ],
      guestOptions: () => [],
    });
    state = controller;
    const model = createCalendarComposer({
      controller,
      pending: false,
      isEdit: thisEvent,
      showRecurringEditNotice: thisEvent,
      timeFormat,
      onSubmit: vi.fn(),
    });
    if (thisEvent) model.changeEditScope('this_event');
    return (
      <ComposerRoot model={model}>
        <MobileComposerWhen />
      </ComposerRoot>
    );
  });
  if (!state) throw new Error('Expected controller');
  return state;
}

it('moves the end date after an overnight time selection', async () => {
  const controller = setup();
  await userEvent.click(
    screen.getByRole('combobox', { name: 'event end time' })
  );
  await userEvent.click(screen.getByRole('option', { name: /^1:00am\s+5h$/ }));
  expect(controller.state().start).toBe('2030-11-11T20:00');
  expect(controller.state().end).toBe('2030-11-12T01:00');
  expect(
    screen.getByRole('button', { name: 'Edit event end date' }).textContent
  ).toContain('12');
});

it('converts the range through the All day control and restores clock fields', async () => {
  const controller = setup();
  await userEvent.click(screen.getByText('All day', { exact: true }));
  expect(controller.state().allDay).toBe(true);
  expect(controller.state().start).toBe('2030-11-11');
  expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  await userEvent.click(screen.getByText('All day', { exact: true }));
  expect(controller.state().allDay).toBe(false);
  expect(screen.getAllByRole('combobox')).toHaveLength(2);
});

it('commits both range dates without changing the displayed 24-hour times', async () => {
  const controller = setup('24-hour');
  expect(
    screen.getByRole('combobox', { name: 'event start time' }).textContent
  ).toBe('20:00');
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit event start date' })
  );
  await userEvent.click(screen.getByRole('gridcell', { name: '11' }));
  await userEvent.click(screen.getByRole('gridcell', { name: '13' }));
  expect(controller.state().start).toBe('2030-11-11T20:00');
  expect(controller.state().end).toBe('2030-11-13T21:00');
  expect(
    screen.getByRole('combobox', { name: 'event end time' }).textContent
  ).toBe('21:00');
});

it('announces why recurrence cannot change for a single occurrence', () => {
  setup('12-hour', true);
  const repeat = screen.getByRole('button', { name: 'Repeats' });
  const reasonId = repeat.getAttribute('aria-describedby');
  expect(reasonId).toBeTruthy();
  expect(document.getElementById(reasonId ?? '')?.textContent).toContain(
    'All events'
  );
});

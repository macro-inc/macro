import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerWhenRoot } from '../when/ComposerWhenRoot';
import { DesktopComposerFields } from './DesktopComposerFields';

vi.mock('../description/ComposerDescription', () => ({
  ComposerDescription: () => <div />,
}));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: () => <div />,
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens each summary independently and keeps the open groups in place', async () => {
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-13T09:00:00'), false),
        title: 'Planning',
        calendarId: 'primary',
      },
      calendarOptions: () => [
        { id: 'primary', label: 'Work', color: '#549eff' },
      ],
      guestOptions: () => [],
    });
    return (
      <ComposerRoot
        model={createCalendarComposer({
          controller,
          pending: false,
          guestPolicyEditable: true,
          onSubmit: vi.fn(),
        })}
      >
        <ComposerWhenRoot>
          <DesktopComposerFields macroCallsEnabled={false} />
        </ComposerWhenRoot>
      </ComposerRoot>
    );
  });
  await userEvent.click(screen.getByRole('button', { name: /Nov 13, / }));
  expect(
    screen.getByRole('button', { name: 'Edit event start date' })
  ).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Add guests' }));
  expect(
    screen.getByRole('button', { name: 'Edit event start date' })
  ).toBeTruthy();
  expect(screen.getByText('Guest permissions')).toBeTruthy();
  const calendarSummary = screen.getByRole('button', { name: 'Calendar' });
  await userEvent.click(calendarSummary);
  expect(screen.getByRole('button', { name: 'Reminder' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Availability' })).toBeTruthy();
  expect(calendarSummary.isConnected).toBe(false);
});

it('retains the title input and open date group when pinning', async () => {
  const { CalendarDesktopPlacement } = await import(
    '../../../views/composer/CalendarDesktopPlacement'
  );
  render(() => {
    const [pinned, setPinned] = createSignal(false);
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-13T09:00:00'), false),
        calendarId: 'primary',
      },
      calendarOptions: () => [
        { id: 'primary', label: 'Work', color: '#549eff' },
      ],
      guestOptions: () => [],
    });
    return (
      <ComposerRoot
        model={createCalendarComposer({
          controller,
          pending: false,
          onSubmit: vi.fn(),
        })}
      >
        <CalendarDesktopPlacement
          pinned={pinned()}
          onTogglePin={() => setPinned(!pinned())}
          onClose={vi.fn()}
          macroCallsEnabled={false}
        />
      </ComposerRoot>
    );
  });
  const title = screen.getByRole('textbox', { name: 'Title' });
  await userEvent.type(title, 'Review');
  await userEvent.click(screen.getByRole('button', { name: /Nov 13, / }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Pin event composer' })
  );
  expect(screen.getByRole('textbox', { name: 'Title' })).toBe(title);
  expect(
    screen.getByRole('button', { name: 'Edit event start date' })
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Unpin event composer' })
  ).toBeTruthy();
});

it('summarizes confidential visibility as private without changing untouched metadata', () => {
  let model!: ReturnType<typeof createCalendarComposer>;
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-13T09:00:00'), false),
        title: 'Planning',
        calendarId: 'primary',
      },
      calendarOptions: () => [
        { id: 'primary', label: 'Work', color: '#549eff' },
      ],
      guestOptions: () => [],
    });
    model = createCalendarComposer({
      controller,
      isEdit: true,
      initialMetadata: { visibility: 'confidential' },
      pending: false,
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerWhenRoot>
          <DesktopComposerFields macroCallsEnabled={false} />
        </ComposerWhenRoot>
      </ComposerRoot>
    );
  });
  expect(screen.getByText(/busy, private/)).toBeTruthy();
  expect(model.submission()?.changes.visibility).toBeUndefined();
});

it('passes an explicit Busy/Free change from the expanded calendar group to submission', async () => {
  let model!: ReturnType<typeof createCalendarComposer>;
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-13T09:00:00'), false),
        title: 'Planning',
        calendarId: 'primary',
      },
      calendarOptions: () => [
        { id: 'primary', label: 'Work', color: '#549eff' },
      ],
      guestOptions: () => [],
    });
    model = createCalendarComposer({
      controller,
      pending: false,
      initialMetadata: { transparency: 'opaque' },
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerWhenRoot>
          <DesktopComposerFields macroCallsEnabled={false} />
        </ComposerWhenRoot>
      </ComposerRoot>
    );
  });
  expect(model.submission()?.changes.transparency).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Calendar' }));
  await userEvent.click(screen.getByRole('button', { name: 'Availability' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Free' }));
  expect(model.submission()?.changes.transparency).toBe('transparent');
});

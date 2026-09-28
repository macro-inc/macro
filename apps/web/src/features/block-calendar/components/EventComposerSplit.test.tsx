// @vitest-environment jsdom
import type { CalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventComposerSplit } from './EventComposerSplit';

const mocks = vi.hoisted(() => ({
  flag: () => ({ loading: true, enabled: false }),
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => mocks.flag(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { close: vi.fn(), setDisplayName: vi.fn() },
  }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}],
}));
vi.mock('@app/features/calendar/hooks/use-event-editor', () => ({
  useEventEditor: () => ({
    initialValues: () => undefined,
    calendarOptions: () => [],
    guestOptions: () => [],
  }),
}));
vi.mock('@app/features/calendar/components/composer/EventForm', () => ({
  EventForm: (props: { controller: CalendarEventFormController }) => (
    <>
      <output aria-label="Conference">
        {props.controller.state().conference}
      </output>
      <input
        aria-label="Title"
        value={props.controller.state().title}
        onInput={(event) =>
          props.controller.setField('title', event.currentTarget.value)
        }
      />
    </>
  ),
}));
afterEach(cleanup);

it.each([true, false])(
  'uses the resolved conference default when enabled is %s',
  (enabled) => {
    const [flag, setFlag] = createSignal({ loading: true, enabled: false });
    mocks.flag = flag;
    render(() => <EventComposerSplit />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Loading event…');
    setFlag({ loading: false, enabled });
    expect(screen.getByLabelText('Conference').textContent).toBe(
      enabled ? 'macro' : 'none'
    );
    fireEvent.input(screen.getByRole('textbox'), {
      target: { value: 'Draft title' },
    });
    setFlag({ loading: true, enabled: false });
    setFlag({ loading: false, enabled });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(
      'Draft title'
    );
  }
);

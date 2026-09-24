/** @vitest-environment jsdom */
import type { EventFormProps } from '@app/features/calendar/components/composer/EventForm';
import { defaultEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EventComposerSplit } from './EventComposerSplit';

const mocks = vi.hoisted(() => ({
  flag: undefined as (() => { enabled: boolean; loading: boolean }) | undefined,
  savedValues: undefined as
    | ReturnType<typeof defaultEditorInitialValues>
    | undefined,
  capability: undefined as (() => boolean) | undefined,
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () =>
    mocks.flag?.() ?? { enabled: false, loading: true },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { close: vi.fn(), setDisplayName: vi.fn() },
  }),
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  useHotkeyDOMScope: () => [() => {}, 'test-composer'],
}));
vi.mock('@app/features/calendar/hooks/use-event-editor', () => ({
  useEventEditor: (props: { macroCallsEnabled: () => boolean }) => {
    mocks.capability = props.macroCallsEnabled;
    return {
      initialValues: () => mocks.savedValues,
      calendarOptions: () => [],
      guestOptions: () => [],
      eventCreated: () => false,
      saveError: () => undefined,
      disabledFields: () => undefined,
      showRecurringEditNotice: () => false,
      pending: () => false,
      save: vi.fn(),
    };
  },
}));
vi.mock('@app/features/calendar/components/composer/EventForm', () => ({
  EventForm: (props: EventFormProps) => (
    <div>
      <span>{props.controller.state().conference}</span>
      <span>{props.macroCallsEnabled ? 'available' : 'unavailable'}</span>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  mocks.flag = undefined;
  mocks.savedValues = undefined;
  mocks.capability = undefined;
});

it('rejects a stale Macro default while loading and updates the save capability when resolved', () => {
  const [flag, setFlag] = createSignal({ enabled: true, loading: true });
  mocks.flag = flag;
  render(() => (
    <EventComposerSplit
      initialValues={defaultEditorInitialValues(new Date(), true)}
    />
  ));
  expect(screen.getByText('none')).toBeTruthy();
  expect(screen.getByText('unavailable')).toBeTruthy();
  expect(mocks.capability?.()).toBe(false);
  setFlag({ enabled: true, loading: false });
  expect(screen.getByText('none')).toBeTruthy();
  expect(screen.getByText('available')).toBeTruthy();
  expect(mocks.capability?.()).toBe(true);
  setFlag({ enabled: false, loading: false });
  expect(mocks.capability?.()).toBe(false);
});

it('defaults new drafts to Macro when enabled, including an explicit local override', () => {
  mocks.flag = () => ({ enabled: true, loading: false });
  render(() => <EventComposerSplit />);
  expect(screen.getByText('macro')).toBeTruthy();
});

import { recipientEntityMapper } from '@core/user';
import type { PropertyEntitySelector } from '@property/editors/selectors/PropertyEntitySelector';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, createSignal, type JSX, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../../../components/composer/create-calendar-event-form-controller';
import {
  defaultEditorInitialValues,
  guestEmail,
} from '../../../components/composer/event-form-model';
import { ComposerRoot } from '../../../components/composer/root/ComposerRoot';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { MobileComposerGuests } from './MobileComposerGuests';

type SelectorProps = ComponentProps<typeof PropertyEntitySelector>;
const selector = vi.hoisted((): { props?: SelectorProps } => ({}));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (props: SelectorProps) => {
    selector.props = props;
    return null;
  },
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@components/app/mobile/PickerSheet', () => ({
  PickerSheet: {
    Root: (props: {
      children: JSX.Element;
      open: boolean;
      onCancel: () => void;
    }) => (
      <Show when={props.open}>
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        {props.children}
      </Show>
    ),
    Header: (props: { onDone: () => void; title: string }) => (
      <button type="button" onClick={props.onDone}>
        Done
      </button>
    ),
    Body: (props: { children: JSX.Element }) => <div>{props.children}</div>,
  },
}));
afterEach(() => {
  cleanup();
  selector.props = undefined;
});

const invited = recipientEntityMapper('user')({
  id: 'macro|invited@example.com',
  email: 'invited@example.com',
  name: 'Invited',
});
const added = recipientEntityMapper('user')({
  id: 'macro|added@example.com',
  email: 'added@example.com',
  name: 'Added',
});

function setup(addOnly = true) {
  const [locked, setLocked] = createSignal(false);
  let controller!: ReturnType<typeof createCalendarEventFormController>;
  render(() => {
    controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T20:00'), false),
        calendarId: 'calendar',
        guests: addOnly ? 'invited@example.com' : '',
      },
      calendarOptions: () => [
        { id: 'calendar', label: 'Calendar', color: 'var(--color-blue-ink)' },
      ],
      guestOptions: () => [invited, added],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      isEdit: addOnly,
      addOnlyGuests: addOnly,
      get disabledFields() {
        return locked() ? { guests: true } : {};
      },
      timeFormat: '12-hour',
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <MobileComposerGuests />
      </ComposerRoot>
    );
  });
  return { controller, setLocked };
}

function picker() {
  if (!selector.props) throw new Error('Guest picker did not mount');
  return selector.props;
}

it('stages guests until Done, discards Cancel, and protects invited guests', async () => {
  const user = userEvent.setup();
  const { controller } = setup();
  expect(screen.queryByRole('button', { name: 'Remove Invited' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  expect(picker().config.excludedIds?.().has('macro|invited@example.com')).toBe(
    true
  );
  picker().onUserSelected?.(
    { id: 'macro|new@example.com', email: 'new@example.com', name: 'New' },
    true
  );
  picker().setSelectedOptions(new Set(['macro|new@example.com']));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  expect(picker().selectedOptions()).toEqual(new Set());
  picker().onUserSelected?.(
    { id: 'macro|new@example.com', email: 'new@example.com', name: 'New' },
    true
  );
  picker().setSelectedOptions(new Set(['macro|new@example.com']));
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
    'new@example.com',
  ]);
  expect(screen.queryByRole('button', { name: 'Remove Invited' })).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Remove new@example.com' })
  );
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
});

it('drops an open draft on permission loss and does not reopen it on restoration', async () => {
  const user = userEvent.setup();
  const { controller, setLocked } = setup();
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  picker().setSelectedOptions(new Set(['macro|added@example.com']));
  setLocked(true);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add people' })).toBeNull();
  setLocked(false);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  expect(picker().selectedOptions()).toEqual(new Set());
});

it('allows removing an already added guest before inviting them', async () => {
  const user = userEvent.setup();
  const { controller } = setup();
  controller.setSelectedGuests([invited, added]);
  expect(screen.getByRole('button', { name: 'Remove Added' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Remove Added' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
});

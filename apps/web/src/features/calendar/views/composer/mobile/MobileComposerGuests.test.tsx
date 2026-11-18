import { recipientEntityMapper } from '@core/user';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarEventFormController } from '../../../components/composer/create-calendar-event-form-controller';
import {
  defaultEditorInitialValues,
  guestEmail,
} from '../../../components/composer/event-form-model';
import { PhoneComposerMenuRoot } from '../../../components/composer/phone-menu/PhoneComposerMenuRoot';
import { ComposerRoot } from '../../../components/composer/root/ComposerRoot';
import { ComposerWhenRoot } from '../../../components/composer/when/ComposerWhenRoot';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { MobileComposerGuests } from './MobileComposerGuests';

const availability = vi.hoisted(() => ({ confirmed: false }));
vi.mock('@property/editors/selectors/entityUtils', () => ({
  useQuickAccessEntities: () => ({
    items: () => [],
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    hasMore: () => false,
    loadMore: async () => {},
  }),
}));
vi.mock('@queries/calendar/team-availability', () => ({
  useTeamAvailabilityQuery: () => ({
    isLoading: false,
    isSuccess: availability.confirmed,
    data: {
      members: [
        {
          userId: 'macro|added@example.com',
          busy: [{ start: '2030-11-11T20:00Z', end: '2030-11-11T21:00Z' }],
          coverage: 'unknown',
        },
      ],
    },
  }),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  availability.confirmed = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

function setup() {
  const [locked, setLocked] = createSignal(false);
  let controller:
    | ReturnType<typeof createCalendarEventFormController>
    | undefined;
  render(() => {
    const current = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-11-11T20:00'), false),
        calendarId: 'calendar',
        guests: 'invited@example.com',
      },
      calendarOptions: () => [
        { id: 'calendar', label: 'Calendar', color: 'var(--color-blue-ink)' },
      ],
      guestOptions: () => [invited, added],
    });
    controller = current;
    const model = createCalendarComposer({
      controller: current,
      pending: false,
      isEdit: true,
      addOnlyGuests: true,
      get disabledFields() {
        return locked() ? { guests: true } : {};
      },
      timeFormat: '12-hour',
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerWhenRoot>
          <PhoneComposerMenuRoot scrollElement={() => undefined}>
            <MobileComposerGuests />
          </PhoneComposerMenuRoot>
        </ComposerWhenRoot>
      </ComposerRoot>
    );
  });
  if (!controller) throw new Error('Missing controller');
  return { controller, setLocked };
}

it('stages people until Done and cancels with Back while preserving protected guests', async () => {
  const user = userEvent.setup();
  const { controller } = setup();
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  await user.click(
    screen.getByRole('button', { name: /Added added@example.com/ })
  );
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  expect(screen.queryByRole('button', { name: 'Remove Added' })).toBeNull();
  await user.click(
    screen.getByRole('button', { name: /Added added@example.com/ })
  );
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
    'added@example.com',
  ]);
  expect(screen.queryByRole('button', { name: 'Remove Invited' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Remove Added' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
});

it('drops the staged page on permission loss without reopening it', async () => {
  const user = userEvent.setup();
  const { controller, setLocked } = setup();
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  await user.click(
    screen.getByRole('button', { name: /Added added@example.com/ })
  );
  setLocked(true);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  setLocked(false);
  expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
  ]);
});

it('offers a literal address without redirecting to a fuzzy contact', async () => {
  const user = userEvent.setup();
  const { controller } = setup();
  await user.click(screen.getByRole('button', { name: 'Add people' }));
  await user.type(screen.getByRole('textbox'), 'new@example.com');
  await user.click(
    screen.getByRole('button', { name: 'Invite new@example.com' })
  );
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(controller.selectedGuests().map(guestEmail)).toEqual([
    'invited@example.com',
    'new@example.com',
  ]);
});

it('renders only a reported busy interval, even when other coverage is unknown', async () => {
  availability.confirmed = true;
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Add people' }));
  expect(screen.getAllByRole('img', { name: 'Busy' })).toHaveLength(1);
});

it('does not turn failed availability into a busy or free assertion', async () => {
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Add people' }));
  expect(screen.queryByRole('img', { name: 'Busy' })).toBeNull();
});

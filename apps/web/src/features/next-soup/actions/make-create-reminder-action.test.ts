import type { EntityData } from '@entity';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EntityActionListState } from './entity-action-context';

const mocks = vi.hoisted(() => ({ open: vi.fn(), enabled: true }));
vi.mock('@app/features/reminders/reminder-composer', () => ({
  openReminderComposer: mocks.open,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableReminders: {},
  isFeatureEnabled: () => mocks.enabled,
}));

import { makeCreateReminderAction } from './make-create-reminder-action';

const entity = (type: EntityData['type'], id = 'thread') =>
  ({ type, id, name: 'Subject' }) as EntityData;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
});

it.each([
  'document',
  'chat',
  'channel',
  'channel_thread',
  'crm_company',
  'crm_contact',
  'project',
  'call',
  'calendar_event',
  'reminder',
  'routine',
] as const)('does not offer or open reminders for %s', (type) => {
  const action = makeCreateReminderAction();
  expect(action.canExecute(entity(type))).toBe(false);
  action.execute([entity(type)]);
  expect(mocks.open).not.toHaveBeenCalled();
});
it('opens an email and defers navigation until the save succeeds', async () => {
  const onSaved = vi.fn();
  const target = entity('email');
  const action = makeCreateReminderAction({ onEmailSaved: onSaved });
  expect(action.canExecute(target)).toBe(true);
  action.execute([target]);
  expect(onSaved).not.toHaveBeenCalled();
  await mocks.open.mock.calls[0][1].onCreated();
  expect(onSaved).toHaveBeenCalledOnce();
});
it('rechecks the flag for stale menu entries', () => {
  const action = makeCreateReminderAction();
  mocks.enabled = false;
  expect(action.canExecute(entity('email'))).toBe(false);
  action.execute([entity('email')]);
  expect(mocks.open).not.toHaveBeenCalled();
});
it('advances to the current next row only after the email snooze has been saved', async () => {
  const previousNext = entity('email', 'previous-next');
  const next = entity('email', 'next');
  const peekOffset = vi.fn(() => ({
    row: { id: previousNext.id, original: previousNext },
  }));
  const soup = {
    navigate: { peekOffset },
    selection: { clear: vi.fn() },
    focus: { set: vi.fn() },
  };
  const onNavigate = vi.fn();
  await makeCreateReminderAction().executeWithSoup(
    [entity('email')],
    soup as unknown as EntityActionListState,
    { advances: true, onNavigate }
  );
  expect(soup.selection.clear).not.toHaveBeenCalled();
  peekOffset.mockReturnValue({ row: { id: next.id, original: next } });
  await mocks.open.mock.calls[0][1].onCreated();
  expect(soup.focus.set).toHaveBeenCalledWith('next');
  expect(onNavigate).toHaveBeenCalledWith({
    actionId: 'create-reminder',
    entity: next,
  });
});

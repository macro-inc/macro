import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openReminderComposer: vi.fn(),
  remindersEnabled: true,
}));

vi.mock('@app/features/reminders/reminder-composer', () => ({
  openReminderComposer: mocks.openReminderComposer,
}));

// Spread the original so the other flags in this module keep working; only the
// reminders gate is driven by the tests. Under vitest MODE is not
// 'development', so the real ENABLE_REMINDERS would resolve to false.
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_REMINDERS: () => mocks.remindersEnabled,
}));

import { makeCreateReminderAction } from './make-create-reminder-action';

const entity = (type: EntityData['type'], id = 'e1') =>
  ({ type, id, name: 'Thing' }) as EntityData;

const threadEntity = (channelId = 'chan-1') =>
  ({
    type: 'channel_thread',
    id: 'msg-1',
    channelId,
    name: 'Channel thread',
    content: 'ship it',
  }) as EntityData;

describe('makeCreateReminderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remindersEnabled = true;
  });

  it('can run for entity types the reminders API accepts', () => {
    const { canExecute } = makeCreateReminderAction();

    expect(canExecute(entity('document'))).toBe(true);
    expect(canExecute(entity('email'))).toBe(true);
    expect(canExecute(entity('crm_company'))).toBe(true);
  });

  // `entity_access` resolves no access level for `channel_message`, so the
  // receipt the reminders API requires cannot be minted for one.
  it('cannot run for entity types with no reminder mapping', () => {
    const { canExecute } = makeCreateReminderAction();

    expect(canExecute(entity('channel_message'))).toBe(false);
    expect(canExecute(entity('automation'))).toBe(false);
  });

  // Thread rows are offered the action even though `channel_message` is not a
  // reminder target: they fall back to the parent channel.
  it('can run for a channel thread row', () => {
    expect(makeCreateReminderAction().canExecute(threadEntity())).toBe(true);
  });

  it('opens the composer for a channel thread row', () => {
    const target = threadEntity();

    makeCreateReminderAction().execute([target]);

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(target);
  });

  it('opens the composer for the entity', () => {
    const target = entity('document', 'doc-1');

    makeCreateReminderAction().execute([target]);

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(target);
  });

  it('does nothing for an empty selection', () => {
    makeCreateReminderAction().execute([]);

    expect(mocks.openReminderComposer).not.toHaveBeenCalled();
  });

  // A reminder points at one thing, so a multi-select uses the first entity
  // rather than opening a composer per item.
  it('uses only the first entity of a multi-selection', () => {
    const first = entity('document', 'doc-1');

    makeCreateReminderAction().execute([first, entity('document', 'doc-2')]);

    expect(mocks.openReminderComposer).toHaveBeenCalledOnce();
    expect(mocks.openReminderComposer).toHaveBeenCalledWith(first);
  });

  it('does not open the composer for an unsupported entity', () => {
    makeCreateReminderAction().execute([entity('channel_message')]);

    expect(mocks.openReminderComposer).not.toHaveBeenCalled();
  });

  // Every surface gates on canExecute, so a closed flag removes the hotkey, both
  // soup menus and the block menu at once.
  it('cannot run when the reminders flag is off', () => {
    mocks.remindersEnabled = false;

    expect(makeCreateReminderAction().canExecute(entity('document'))).toBe(
      false
    );
  });

  // execute re-checks the gate, so a command-menu entry left over from before
  // the flag closed cannot still open the composer.
  it('does not open the composer when the reminders flag is off', () => {
    mocks.remindersEnabled = false;

    makeCreateReminderAction().execute([entity('document', 'doc-1')]);

    expect(mocks.openReminderComposer).not.toHaveBeenCalled();
  });

  // The soup context menu and soup command menu both drive actions through
  // executeWithSoup, so the action is unreachable from a list without it.
  it('opens the composer when driven from a soup list', async () => {
    const target = entity('channel', 'channel-1');

    await makeCreateReminderAction().executeWithSoup(
      [target],
      {} as Parameters<
        ReturnType<typeof makeCreateReminderAction>['executeWithSoup']
      >[1]
    );

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(target);
  });
});

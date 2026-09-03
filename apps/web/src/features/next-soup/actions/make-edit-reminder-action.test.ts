import type { EntityData, ReminderEntity } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openEntityInSplitFromUnifiedList: vi.fn(),
  remindersEnabled: true,
  activeSplit: { id: 'controller' } as unknown,
}));

// The action opens the reminder's editor the same way a row click does.
vi.mock('../utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.openEntityInSplitFromUnifiedList,
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ activeSplit: () => mocks.activeSplit }),
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableReminders: { key: 'enable-reminders' },
  isFeatureEnabled: (flag: { key?: string }) =>
    flag.key === 'enable-reminders' ? mocks.remindersEnabled : false,
}));

import { makeEditReminderAction } from './make-edit-reminder-action';

const reminder = (overrides: Partial<ReminderEntity> = {}) =>
  ({ type: 'reminder', id: 'rem-1', ...overrides }) as ReminderEntity;

const entity = (type: EntityData['type'], id = 'e1') =>
  ({ type, id, name: 'Thing' }) as EntityData;

describe('makeEditReminderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remindersEnabled = true;
  });

  it('can run for a reminder', () => {
    expect(makeEditReminderAction().canExecute(reminder())).toBe(true);
  });

  it('cannot run for anything that is not a reminder', () => {
    const { canExecute } = makeEditReminderAction();

    expect(canExecute(entity('document'))).toBe(false);
    expect(canExecute(entity('email'))).toBe(false);
  });

  it('opens the reminder editor through the shared open path', () => {
    const row = reminder();
    makeEditReminderAction().execute([row]);

    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledWith(
      row,
      expect.objectContaining({
        splitHandle: mocks.activeSplit,
        referredFrom: null,
      })
    );
  });

  it('does nothing for an empty selection', () => {
    makeEditReminderAction().execute([]);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
  });

  // The editor is about one reminder's time, so a multi-select is not a batch —
  // the menu only offers it for a single row, and the action takes the first.
  it('uses only the first entity of a multi-selection', () => {
    const first = reminder();

    makeEditReminderAction().execute([first, reminder({ id: 'rem-2' })]);

    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledOnce();
    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledWith(
      first,
      expect.anything()
    );
  });

  it('does not open the editor for a non-reminder', () => {
    makeEditReminderAction().execute([entity('document')]);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
  });

  it('cannot run when the reminders flag is off', () => {
    mocks.remindersEnabled = false;

    expect(makeEditReminderAction().canExecute(reminder())).toBe(false);
  });

  // execute re-checks the gate, so a command-menu entry left over from before
  // the flag closed cannot still open the editor.
  it('does not open the editor when the reminders flag is off', () => {
    mocks.remindersEnabled = false;

    makeEditReminderAction().execute([reminder()]);

    expect(mocks.openEntityInSplitFromUnifiedList).not.toHaveBeenCalled();
  });

  // The soup context menu and soup command menu both drive actions through
  // executeWithSoup, so the action is unreachable from a list without it.
  it('opens the editor when driven from a soup list', async () => {
    await makeEditReminderAction().executeWithSoup(
      [reminder()],
      {} as Parameters<
        ReturnType<typeof makeEditReminderAction>['executeWithSoup']
      >[1]
    );

    expect(mocks.openEntityInSplitFromUnifiedList).toHaveBeenCalledOnce();
  });
});

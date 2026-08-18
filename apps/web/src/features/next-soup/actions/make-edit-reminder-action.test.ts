import type { EntityData, ReminderEntity } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openReminderEditor: vi.fn(),
  remindersEnabled: true,
  cachedPreview: undefined as { rawName: string; access: string } | undefined,
}));

vi.mock('@app/features/reminders/reminder-composer', () => ({
  openReminderEditor: mocks.openReminderEditor,
}));

// The reference name comes from the preview cache the row already populated.
vi.mock('@queries/preview', () => ({
  getCachedItemPreview: () => mocks.cachedPreview,
  isAccessiblePreviewItem: (item: { access?: string } | undefined) =>
    item?.access === 'access',
}));

// Spread the original so the other flags in this module keep working; only the
// reminders gate is driven by the tests. Under vitest MODE is not
// 'development', so the real ENABLE_REMINDERS would resolve to false.
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_REMINDERS: () => mocks.remindersEnabled,
}));

import { makeEditReminderAction } from './make-edit-reminder-action';

const NEXT_RUN = '2026-08-09T09:00:00.000Z';

const reminder = (overrides: Partial<ReminderEntity> = {}) =>
  ({
    type: 'reminder',
    id: 'rem-1',
    name: 'Chase the contract',
    description: 'Chase the contract',
    ownerId: '',
    scheduleType: 'once',
    nextRunAt: NEXT_RUN,
    enabled: true,
    ...overrides,
  }) as ReminderEntity;

const entity = (type: EntityData['type'], id = 'e1') =>
  ({ type, id, name: 'Thing' }) as EntityData;

describe('makeEditReminderAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.remindersEnabled = true;
    mocks.cachedPreview = undefined;
  });

  it('can run for a one-shot reminder', () => {
    expect(makeEditReminderAction().canExecute(reminder())).toBe(true);
  });

  it('cannot run for anything that is not a reminder', () => {
    const { canExecute } = makeEditReminderAction();

    expect(canExecute(entity('document'))).toBe(false);
    expect(canExecute(entity('email'))).toBe(false);
  });

  it('can run for a recurring reminder', () => {
    const recurring = reminder({
      scheduleType: 'recurring',
      cron: '0 0 9 * * *',
      timezone: 'UTC',
    });

    expect(makeEditReminderAction().canExecute(recurring)).toBe(true);
  });

  it('opens the editor with the reminder as the row knows it', () => {
    makeEditReminderAction().execute([reminder()]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith({
      id: 'rem-1',
      description: 'Chase the contract',
      remindAt: new Date(NEXT_RUN),
      schedule: { type: 'once', remindAt: new Date(NEXT_RUN).toISOString() },
      completed: false,
    });
  });

  // The composer diffs the edit against this, so a recurring reminder has to
  // arrive as its cron rather than as its next firing — otherwise opening one
  // and saving it would quietly flatten the series into a single date.
  // The row and the editor both rebuild the schedule from a soup row, and each
  // inventing its own substitution for an absent zone would describe the same
  // reminder two ways — with the editor's diff then reading the substitution as
  // a change and re-sending it, moving when the reminder fires. UTC is the
  // shared fallback because it does not depend on who is looking.
  it('falls back to UTC for a recurring reminder with no timezone', () => {
    makeEditReminderAction().execute([
      reminder({ scheduleType: 'recurring', cron: '0 0 9 * * *' }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: { type: 'recurring', cron: '0 0 9 * * *', timezone: 'UTC' },
      })
    );
  });

  it('passes a recurring reminder its cron, not its next firing', () => {
    makeEditReminderAction().execute([
      reminder({
        scheduleType: 'recurring',
        cron: '0 0 9 * * 2-6',
        timezone: 'America/New_York',
      }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          type: 'recurring',
          cron: '0 0 9 * * 2-6',
          timezone: 'America/New_York',
        },
      })
    );
  });

  // A reschedule has to clear the done flag, so the editor needs to know the
  // reminder was completed — see reminderEditPatch.
  it('reports a completed reminder as completed', () => {
    makeEditReminderAction().execute([
      reminder({ completedAt: '2026-08-08T10:00:00.000Z' }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ completed: true })
    );
  });

  // Blanking the description in the editor means "name it after what it is
  // about", exactly as it does when creating — so the name has to travel with
  // the draft.
  it('carries the reference name as the blank-description fallback', () => {
    mocks.cachedPreview = { rawName: 'Q3 Contract', access: 'access' };

    makeEditReminderAction().execute([
      reminder({ referencedEntity: { id: 'doc-1', type: 'document' } }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDescription: 'Q3 Contract' })
    );
  });

  it('falls back to how lists label an unnamed reference', () => {
    mocks.cachedPreview = { rawName: '', access: 'access' };

    makeEditReminderAction().execute([
      reminder({ referencedEntity: { id: 'thread-1', type: 'email' } }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDescription: '(No Subject)' })
    );
  });

  // Without a fallback the editor keeps the existing description, rather than
  // renaming the reminder to a placeholder because a lookup missed.
  it('carries no fallback for a standalone reminder', () => {
    makeEditReminderAction().execute([reminder()]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDescription: undefined })
    );
  });

  it('carries no fallback when the reference is not cached', () => {
    mocks.cachedPreview = undefined;

    makeEditReminderAction().execute([
      reminder({ referencedEntity: { id: 'doc-1', type: 'document' } }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDescription: undefined })
    );
  });

  it('carries no fallback when the reference is inaccessible', () => {
    mocks.cachedPreview = { rawName: 'Secret', access: 'no_access' };

    makeEditReminderAction().execute([
      reminder({ referencedEntity: { id: 'doc-1', type: 'document' } }),
    ]);

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDescription: undefined })
    );
  });

  it('does nothing for an empty selection', () => {
    makeEditReminderAction().execute([]);

    expect(mocks.openReminderEditor).not.toHaveBeenCalled();
  });

  // The editor asks about one reminder's time, so a multi-select is not a
  // batch — the menu only offers it for a single row.
  it('uses only the first entity of a multi-selection', () => {
    const first = reminder();

    makeEditReminderAction().execute([first, reminder({ id: 'rem-2' })]);

    expect(mocks.openReminderEditor).toHaveBeenCalledOnce();
    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rem-1' })
    );
  });

  it('does not open the editor for a non-reminder', () => {
    makeEditReminderAction().execute([entity('document')]);

    expect(mocks.openReminderEditor).not.toHaveBeenCalled();
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

    expect(mocks.openReminderEditor).not.toHaveBeenCalled();
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

    expect(mocks.openReminderEditor).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rem-1' })
    );
  });
});

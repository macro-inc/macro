import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  closeReminderComposer,
  openReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
} from './reminder-composer';

const doc = (id: string, name: string) =>
  ({ type: 'document', id, name }) as EntityData;

describe('reminder composer state', () => {
  beforeEach(() => {
    closeReminderComposer();
  });

  it('opens with the entity the command was invoked on', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));

    expect(reminderComposerOpen()).toBe(true);
    expect(reminderComposerState.entity?.id).toBe('doc-1');
  });

  it('clears the entity on close', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));
    closeReminderComposer();

    expect(reminderComposerOpen()).toBe(false);
    expect(reminderComposerState.entity).toBeUndefined();
  });

  // Reopening must fully replace the target, or a reminder could be attached to
  // the previously opened entity.
  it('replaces the entity when reopened for another one', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));
    closeReminderComposer();
    openReminderComposer(doc('doc-2', 'Roadmap'));

    expect(reminderComposerState.entity?.id).toBe('doc-2');
    expect(reminderComposerState.entity?.name).toBe('Roadmap');
  });

  it('replaces the entity even without an intervening close', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));
    openReminderComposer(doc('doc-2', 'Roadmap'));

    expect(reminderComposerState.entity?.id).toBe('doc-2');
  });
});

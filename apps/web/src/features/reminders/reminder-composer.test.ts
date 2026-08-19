import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeReminderComposer,
  openReminderComposer,
  openReminderEditor,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
} from './reminder-composer';

const doc = (id: string, name: string) =>
  ({ type: 'document', id, name }) as EntityData;

const draft = (id: string, description: string) => ({
  id,
  description,
  remindAt: new Date('2026-08-09T09:00:00.000Z'),
  completed: false,
});

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

describe('reminder composer edit mode', () => {
  beforeEach(() => {
    closeReminderComposer();
  });

  it('opens with the reminder being edited', () => {
    openReminderEditor(draft('rem-1', 'Chase the contract'));

    expect(reminderComposerOpen()).toBe(true);
    expect(reminderComposerState.editing?.id).toBe('rem-1');
    expect(reminderComposerState.editing?.description).toBe(
      'Chase the contract'
    );
  });

  it('clears the reminder on close', () => {
    openReminderEditor(draft('rem-1', 'Chase the contract'));
    closeReminderComposer();

    expect(reminderComposerOpen()).toBe(false);
    expect(reminderComposerState.editing).toBeUndefined();
  });

  // The two modes are exclusive: the modal shows an entity chip for one and
  // prefills from the reminder for the other, so a leftover from the previous
  // open would put it in both at once.
  it('drops a create target when opened to edit', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));
    openReminderEditor(draft('rem-1', 'Chase the contract'));

    expect(reminderComposerState.entity).toBeUndefined();
    expect(reminderComposerState.editing?.id).toBe('rem-1');
  });

  it('drops an edit target when opened to create', () => {
    openReminderEditor(draft('rem-1', 'Chase the contract'));
    openReminderComposer(doc('doc-1', 'Q3 Contract'));

    expect(reminderComposerState.editing).toBeUndefined();
    expect(reminderComposerState.entity?.id).toBe('doc-1');
  });

  it('replaces the reminder when reopened for another one', () => {
    openReminderEditor(draft('rem-1', 'Chase the contract'));
    openReminderEditor(draft('rem-2', 'Send the invoice'));

    expect(reminderComposerState.editing?.id).toBe('rem-2');
    expect(reminderComposerState.editing?.description).toBe('Send the invoice');
  });
});

describe('reminder composer created handler', () => {
  beforeEach(() => {
    closeReminderComposer();
  });

  // The composer closes before the create request is awaited, so the follow-up
  // has to be taken out of here first rather than read after the fact.
  it('hands the created handler over once', () => {
    const onCreated = vi.fn();
    openReminderComposer(doc('doc-1', 'Q3 Contract'), { onCreated });

    expect(takeReminderCreatedHandler()).toBe(onCreated);
    expect(takeReminderCreatedHandler()).toBeUndefined();
  });

  it('drops the created handler when the composer is closed', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'), { onCreated: vi.fn() });
    closeReminderComposer();

    expect(takeReminderCreatedHandler()).toBeUndefined();
  });

  // Editing an existing reminder is not a create, so the previous open's
  // follow-up must not survive into it.
  it('drops the created handler when opened to edit', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'), { onCreated: vi.fn() });
    openReminderEditor(draft('rem-1', 'Chase the contract'));

    expect(takeReminderCreatedHandler()).toBeUndefined();
  });

  it('drops the previous created handler when reopened to create', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'), { onCreated: vi.fn() });
    openReminderComposer(doc('doc-2', 'Roadmap'));

    expect(takeReminderCreatedHandler()).toBeUndefined();
  });
});

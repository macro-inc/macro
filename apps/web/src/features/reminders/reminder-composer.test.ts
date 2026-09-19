import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeReminderComposer,
  openReminderComposer,
  openStandaloneReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
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

describe('reminder composer standalone mode', () => {
  beforeEach(() => {
    closeReminderComposer();
  });

  // The flag is what the modal reads to know it is composing at all: with no
  // entity, a closed composer and a standalone one look alike.
  it('opens with no entity target', () => {
    openStandaloneReminderComposer();

    expect(reminderComposerOpen()).toBe(true);
    expect(reminderComposerState.standalone).toBe(true);
    expect(reminderComposerState.entity).toBeUndefined();
  });

  it('clears the flag on close', () => {
    openStandaloneReminderComposer();
    closeReminderComposer();

    expect(reminderComposerOpen()).toBe(false);
    expect(reminderComposerState.standalone).toBeUndefined();
  });

  // The two modes are exclusive. A leftover flag would make the modal treat an
  // entity's reminder as being about nothing, and drop the attachment.
  it('drops a create target when opened standalone', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'));
    openStandaloneReminderComposer();

    expect(reminderComposerState.entity).toBeUndefined();
    expect(reminderComposerState.standalone).toBe(true);
  });

  it('drops the standalone flag when opened for an entity', () => {
    openStandaloneReminderComposer();
    openReminderComposer(doc('doc-1', 'Q3 Contract'));

    expect(reminderComposerState.standalone).toBeUndefined();
    expect(reminderComposerState.entity?.id).toBe('doc-1');
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

  it('drops the previous created handler when reopened to create', () => {
    openReminderComposer(doc('doc-1', 'Q3 Contract'), { onCreated: vi.fn() });
    openReminderComposer(doc('doc-2', 'Roadmap'));

    expect(takeReminderCreatedHandler()).toBeUndefined();
  });
});

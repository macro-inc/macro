import type { EntityData } from '@entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
    },
  });
  return {
    openReminderComposer: vi.fn(),
    remindersEnabled: true,
  };
});

vi.mock('@app/features/reminders/reminder-composer', () => ({
  openReminderComposer: mocks.openReminderComposer,
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_BEARER_TOKEN_AUTH: false,
  enableReminders: { key: 'enable-reminders' },
  isFeatureEnabled: (flag: { key?: string }) =>
    flag.key === 'enable-reminders' ? mocks.remindersEnabled : false,
}));

import type { SoupState } from '../create-soup-state';
import {
  makeCreateReminderAction,
  markReminderTargetDone,
} from './make-create-reminder-action';

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

const soupState = () => ({}) as SoupState;

/** The follow-up the action handed the composer for the latest open. */
const composerOnCreated = (): (() => void | Promise<void>) | undefined =>
  mocks.openReminderComposer.mock.calls.at(-1)?.[1]?.onCreated;

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

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(
      target,
      expect.anything()
    );
  });

  it('opens the composer for the entity', () => {
    const target = entity('document', 'doc-1');

    makeCreateReminderAction().execute([target]);

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(
      target,
      expect.anything()
    );
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
    expect(mocks.openReminderComposer).toHaveBeenCalledWith(
      first,
      expect.anything()
    );
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

    await makeCreateReminderAction().executeWithSoup([target], soupState(), {
      advances: true,
    });

    expect(mocks.openReminderComposer).toHaveBeenCalledWith(
      target,
      expect.anything()
    );
  });

  // The row leaves the list only once the reminder that brings it back exists,
  // so the follow-up is handed to the composer rather than run here.
  it('does not run the created handler before the reminder exists', () => {
    const onCreated = vi.fn();

    makeCreateReminderAction({ onCreated }).execute([
      entity('document', 'doc-1'),
    ]);

    expect(onCreated).not.toHaveBeenCalled();
  });

  it('hands the composer a created handler bound to the entity', async () => {
    const onCreated = vi.fn();
    const target = entity('document', 'doc-1');

    makeCreateReminderAction({ onCreated }).execute([target]);
    await composerOnCreated()?.();

    expect(onCreated).toHaveBeenCalledWith(target);
  });

  // Marking done from a list moves focus off the row, which needs the list.
  it('passes the list to the created handler when driven from one', async () => {
    const onCreated = vi.fn();
    const target = entity('email', 'thread-1');
    const soup = soupState();

    await makeCreateReminderAction({ onCreated }).executeWithSoup(
      [target],
      soup,
      { advances: true }
    );
    await composerOnCreated()?.();

    expect(onCreated).toHaveBeenCalledWith(target, { soup, advances: true });
  });

  // Whether the list moves on is the surface's answer, carried through to the
  // handler rather than guessed at from the list.
  it('carries a list that does not advance through to the handler', async () => {
    const onCreated = vi.fn();
    const target = entity('document', 'doc-1');
    const soup = soupState();

    await makeCreateReminderAction({ onCreated }).executeWithSoup(
      [target],
      soup,
      { advances: false }
    );
    await composerOnCreated()?.();

    expect(onCreated).toHaveBeenCalledWith(target, { soup, advances: false });
  });
});

describe('markReminderTargetDone', () => {
  const markDoneStub = () => ({
    canExecute: vi.fn(() => true),
    execute: vi.fn(async () => {}),
    executeWithSoup: vi.fn(async () => {}),
  });

  // The whole point of the follow-up on a list that triages: a reminder leaves
  // the selection on the next row exactly as Mark done does, through the same
  // soup path and the same `onNavigate`.
  it('marks the target done through soup when the list advances', async () => {
    const markDone = markDoneStub();
    const onNavigate = vi.fn();
    const target = entity('email', 'thread-1');
    const soup = soupState();

    await markReminderTargetDone(markDone, onNavigate)(target, {
      soup,
      advances: true,
    });

    expect(markDone.executeWithSoup).toHaveBeenCalledWith(
      [target],
      soup,
      onNavigate,
      { silent: true }
    );
  });

  // A Documents view or a folder does not triage, so advancing would move the
  // selection, and its preview, for no reason.
  it('does not advance a list that says it does not', async () => {
    const markDone = markDoneStub();
    const target = entity('document', 'doc-1');

    await markReminderTargetDone(markDone)(target, {
      soup: soupState(),
      advances: false,
    });

    expect(markDone.executeWithSoup).not.toHaveBeenCalled();
    expect(markDone.execute).toHaveBeenCalledWith([target], undefined, {
      silent: true,
    });
  });

  // No list behind the action (block ⋯ menu, block command menu outside
  // triage): nothing to advance, so the plain path runs. Silent either way —
  // the composer's "Reminder set for …" toast is the feedback.
  it('marks the target done without a list', async () => {
    const markDone = markDoneStub();
    const target = entity('document', 'doc-1');

    await markReminderTargetDone(markDone)(target);

    expect(markDone.execute).toHaveBeenCalledWith([target], undefined, {
      silent: true,
    });
    expect(markDone.executeWithSoup).not.toHaveBeenCalled();
  });

  // A call or a CRM row has no done state of its own, and `canExecute` is the
  // app's answer for which those are.
  it('skips entity types that cannot be marked done', async () => {
    const markDone = markDoneStub();
    markDone.canExecute.mockReturnValue(false);

    await markReminderTargetDone(markDone)(entity('call', 'call-1'));

    expect(markDone.execute).not.toHaveBeenCalled();
    expect(markDone.executeWithSoup).not.toHaveBeenCalled();
  });
});

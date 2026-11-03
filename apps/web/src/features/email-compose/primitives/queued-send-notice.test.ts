import { describe, expect, it, vi } from 'vitest';
import type {
  EmailComposeFeedback,
  EmailSendProgress,
} from '../context/compose-capabilities';
import { announceQueuedSend } from './queued-send-notice';

function setup(options: { sendAttemptId?: string } = { sendAttemptId: 'a' }) {
  const undoList: { undo: () => void; dispose: () => void }[] = [];
  const notices = {
    feedback: {
      success: vi.fn(() => 1),
      failure: vi.fn(() => undefined),
      alert: vi.fn(),
      dismiss: vi.fn(),
    },
    pushUndo: vi.fn((undo: () => void) => {
      const entry = { undo, dispose: vi.fn() };
      undoList.push(entry);
      return entry;
    }),
    blockingNotice: vi.fn(async () => {}),
    confirm: vi.fn(async () => false),
    reportError: vi.fn(),
  } satisfies EmailComposeFeedback;
  let report: (progress: EmailSendProgress) => void = () => {};
  const undo = vi.fn();
  const announcement = announceQueuedSend({
    notices,
    delivery: {
      watchSend: (_id, changed) => {
        report = changed;
        return () => {};
      },
    },
    sendAttemptId: options.sendAttemptId,
    queuedOffline: false,
    undo,
  });
  return {
    announcement,
    notices,
    undoList,
    undo,
    report: (p: EmailSendProgress) => report(p),
  };
}

describe('announceQueuedSend', () => {
  it('lets the undo keys undo a send the way the notice does', () => {
    const { notices, undoList, undo } = setup();
    expect(undoList).toHaveLength(1);

    undoList[0].undo();

    expect(undo).toHaveBeenCalledOnce();
    expect(notices.feedback.dismiss).toHaveBeenCalledWith(1);
    expect(undoList[0].dispose).toHaveBeenCalled();
  });

  it('keeps the send undoable through acceptance until delivery starts', () => {
    const { undoList, report } = setup();
    const undoUntil = new Date(Date.now() + 10_000).toISOString();

    report({ state: 'accepted', undoUntil });
    expect(undoList[0].dispose).not.toHaveBeenCalled();

    report({ state: 'pending' });
    expect(undoList[0].dispose).toHaveBeenCalled();
  });

  it('stops offering undo once the send is delivered', () => {
    const { undoList, report } = setup();
    report({ state: 'sent' });
    expect(undoList[0].dispose).toHaveBeenCalled();
  });

  it('stops offering undo when acceptance comes after the deadline', () => {
    const { undoList, report } = setup();
    report({
      state: 'accepted',
      undoUntil: new Date(Date.now() - 1).toISOString(),
    });
    expect(undoList[0].dispose).toHaveBeenCalled();
  });

  it('moves the send back above work it caused, until its window closes', () => {
    const { announcement, undoList, undo, report } = setup();

    announcement.raiseUndo();
    expect(undoList[0].dispose).toHaveBeenCalled();
    expect(undoList).toHaveLength(2);
    undoList[1].undo();
    expect(undo).toHaveBeenCalledOnce();

    report({ state: 'sent' });
    announcement.raiseUndo();
    expect(undoList).toHaveLength(2);
  });

  it('leaves an untracked send off the undo list', () => {
    const { undoList } = setup({});
    expect(undoList).toHaveLength(0);
  });
});

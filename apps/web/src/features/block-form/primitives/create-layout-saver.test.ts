import { err, ok, type Result, ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormWriteFailure } from '../context/form-context';
import type { FormDetail, FormLayout } from '../core/form-model';
import { createLayoutSaver } from './create-layout-saver';

const layout = (title: string): FormLayout => ({
  sections: [
    {
      id: 'section',
      title,
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      questions: [],
    },
  ],
});

const detailOf = (sent: FormLayout): FormDetail => ({
  form: {
    id: 'form',
    name: 'Form',
    description: '',
    ownerId: 'owner',
    databaseId: 'database',
    tableId: 'table',
    audience: 'members',
    status: 'open',
    closesAt: null,
    tallyVisible: false,
    confirmationMessage: '',
    submittedColumnId: null,
    respondentColumnId: null,
  },
  layout: sent,
  columns: [],
  access: 'owner',
  tableGone: false,
});

/** A save the test answers by hand, in the order it chooses. */
function deferredSaves() {
  const calls: {
    layout: FormLayout;
    resolve: (failure?: FormWriteFailure) => void;
  }[] = [];
  let arrival: (() => void) | undefined;
  /** Resolves once the save numbered `count` (from 1) has been sent. */
  const sent = (count: number) =>
    calls.length >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          arrival = resolve;
        });
  const save = (layout: FormLayout) =>
    new ResultAsync(
      new Promise<Result<FormDetail, FormWriteFailure>>((resolve) => {
        calls.push({
          layout,
          resolve: (failure) =>
            resolve(failure ? err(failure) : ok(detailOf(layout))),
        });
        arrival?.();
        arrival = undefined;
      })
    );
  return { calls, save, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createLayoutSaver', () => {
  it('coalesces edits made within 400ms into one save of the latest layout, and reports saved once it lands', async () => {
    const saves = deferredSaves();
    const saved: [string, boolean][] = [];
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: (detail, idle) =>
          saved.push([detail.layout.sections[0].title, idle]),
        onFailed: () => {},
      });
      saver.schedule(layout('a'));
      await vi.advanceTimersByTimeAsync(300);
      saver.schedule(layout('ab'));
      await vi.advanceTimersByTimeAsync(300);
      expect(saves.calls).toHaveLength(0);
      expect(saver.state()).toBe('pending');
      await vi.advanceTimersByTimeAsync(100);
      expect(saves.calls.map((call) => call.layout.sections[0].title)).toEqual([
        'ab',
      ]);
      expect(saver.state()).toBe('saving');
      saves.calls[0].resolve();
      await saver.flush();
      expect(saved).toEqual([['ab', true]]);
      expect(saver.state()).toBe('saved');
      dispose();
    });
  });

  it('keeps and sends a newer layout when the save before it is refused', async () => {
    const saves = deferredSaves();
    const failed: [string, boolean][] = [];
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: () => {},
        onFailed: (failure, newerPending) =>
          failed.push([failure.message, newerPending]),
      });
      saver.schedule(layout('old'));
      await vi.advanceTimersByTimeAsync(400);
      saver.schedule(layout('new'));
      await vi.advanceTimersByTimeAsync(400);
      saves.calls[0].resolve({ message: 'Refused' });
      await saves.sent(2);
      expect(failed).toEqual([['Refused', true]]);
      expect(saves.calls.map((call) => call.layout.sections[0].title)).toEqual([
        'old',
        'new',
      ]);
      saves.calls[1].resolve();
      await saver.flush();
      expect(saver.state()).toBe('saved');
      dispose();
    });
  });

  it('sends a layout changed during a save only after that save answers', async () => {
    const saves = deferredSaves();
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: () => {},
        onFailed: () => {},
      });
      saver.schedule(layout('first'));
      await vi.advanceTimersByTimeAsync(400);
      saver.schedule(layout('second'));
      await vi.advanceTimersByTimeAsync(400);
      expect(saves.calls).toHaveLength(1);
      saves.calls[0].resolve();
      await saves.sent(2);
      expect(saves.calls.map((call) => call.layout.sections[0].title)).toEqual([
        'first',
        'second',
      ]);
      saves.calls[1].resolve();
      await saver.flush();
      expect(saver.state()).toBe('saved');
      dispose();
    });
  });

  it('holds sends while a column is being created, then sends once released', async () => {
    const saves = deferredSaves();
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: () => {},
        onFailed: () => {},
      });
      const release = saver.hold();
      saver.schedule(layout('with new column'));
      const flushed = saver.flush();
      await vi.advanceTimersByTimeAsync(1000);
      expect(saves.calls).toHaveLength(0);
      release();
      expect(saves.calls).toHaveLength(1);
      saves.calls[0].resolve();
      await flushed;
      expect(saver.state()).toBe('saved');
      dispose();
    });
  });

  it('reports a refused save with nothing newer waiting as failed', async () => {
    const saves = deferredSaves();
    const failures: [string, boolean][] = [];
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: () => {},
        onFailed: (failure, newerPending) =>
          failures.push([failure.message, newerPending]),
      });
      saver.schedule(layout('one'));
      await vi.advanceTimersByTimeAsync(400);
      saves.calls[0].resolve({ message: 'This form changed.' });
      await vi.advanceTimersByTimeAsync(1000);
      expect(failures).toEqual([['This form changed.', false]]);
      expect(saves.calls).toHaveLength(1);
      expect(saver.state()).toBe('failed');
      dispose();
    });
  });

  it('flushes immediately without waiting for the delay', async () => {
    const saves = deferredSaves();
    await createRoot(async (dispose) => {
      const saver = createLayoutSaver({
        save: saves.save,
        delayMs: 400,
        onSaved: () => {},
        onFailed: () => {},
      });
      saver.schedule(layout('now'));
      const flushed = saver.flush();
      expect(saves.calls).toHaveLength(1);
      saves.calls[0].resolve();
      await flushed;
      expect(saver.state()).toBe('saved');
      dispose();
    });
  });
});

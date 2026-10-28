/** @vitest-environment jsdom */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewDecision } from '../core/review';
import { createReviewController } from './review-controller';

const initial: Review = {
  id: 'review',
  sessionId: 'session',
  executionId: 'execution',
  kind: 'email',
  title: 'Emails',
  revision: 0,
  updatedAt: 0,
  items: [
    { id: 'one', draft: { subject: 'Ready?' }, status: 'pending' },
    { id: 'two', draft: { subject: 'When?' }, status: 'pending' },
  ],
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function setup(
  fail = false,
  validate?: (
    item: Review['items'][number],
    kind: Review['kind']
  ) => string | undefined
) {
  let saved = structuredClone(initial);
  const actions = {
    reload: async () => structuredClone(saved),
    decide: vi.fn(async (decision: ReviewDecision) => {
      if (fail || decision.revision !== saved.revision)
        throw new Error('conflict');
      saved = {
        ...saved,
        revision: saved.revision + 1,
        items: saved.items.map((item) =>
          decision.action === 'edit'
            ? item.id === decision.item
              ? { ...item, draft: decision.draft }
              : item
            : decision.items.length === 0 || decision.items.includes(item.id)
              ? {
                  ...item,
                  status:
                    decision.action === 'submit' ? 'submitting' : 'dismissed',
                }
              : item
        ),
      };
      return structuredClone(saved);
    }),
  };
  const controller = createRoot((dispose) => {
    cleanups.push(dispose);
    return createReviewController(() => initial, actions, validate);
  });
  return { controller, actions };
}
describe('persisted review decisions', () => {
  it('adopts presentation acknowledgments but preserves conflicting editor data', async () => {
    const [source, update] = createSignal(initial);
    const actions = {
      reload: async () => source(),
      decide: vi.fn(async () => source()),
    };
    const controller = createRoot((dispose) => {
      cleanups.push(dispose);
      return createReviewController(source, actions);
    });
    update({ ...initial, revision: 1, presentedAt: 100 });
    await Promise.resolve();
    expect(controller.stale()).toBe(false);
    expect(controller.record().presentedAt).toBe(100);
    update({
      ...source(),
      revision: 2,
      items: initial.items.map((item) => ({
        ...item,
        draft: { subject: 'Changed elsewhere' },
      })),
    });
    await Promise.resolve();
    expect(controller.stale()).toBe(true);
  });
  it('saves the latest edits before sending all, using the acknowledged revision', async () => {
    const { controller, actions } = setup();
    controller.edit('one', { subject: 'Ready?', body: 'Yes' });
    controller.edit('two', { subject: 'When?', body: 'Tomorrow' });
    expect(await controller.decide('submit', [])).toBe(true);
    expect(
      actions.decide.mock.calls.map(([call]) => [call.action, call.revision])
    ).toEqual([
      ['edit', 0],
      ['edit', 1],
      ['submit', 2],
    ]);
    expect(
      controller.record().items.every((item) => item.status === 'submitting')
    ).toBe(true);
  });
  it('preflights every selected item before starting any batch action', async () => {
    const { controller, actions } = setup(false, (item) =>
      item.id === 'two' && !JSON.stringify(item.draft).includes('Fixed')
        ? 'Fix the second draft.'
        : undefined
    );
    expect(await controller.decide('submit', [])).toBe(false);
    expect(actions.decide).not.toHaveBeenCalled();
    expect(controller.validation()).toEqual({
      item: 'two',
      message: 'Fix the second draft.',
    });
    expect(controller.error()).toBeUndefined();
    controller.edit('two', { subject: 'Fixed' });
    expect(controller.validation()).toBeUndefined();
    expect(await controller.decide('submit', [])).toBe(true);
    expect(actions.decide.mock.calls.map(([call]) => call.action)).toEqual([
      'edit',
      'submit',
    ]);
  });
  it('does not let an unrelated invalid draft block an individual submission', async () => {
    const { controller, actions } = setup(false, (item) =>
      item.id === 'two' ? 'Fix the second draft.' : undefined
    );
    expect(await controller.decide('submit', ['one'])).toBe(true);
    expect(actions.decide).toHaveBeenCalledExactlyOnceWith({
      action: 'submit',
      revision: 0,
      items: ['one'],
    });
    expect(controller.record().items[1].status).toBe('pending');
  });
  it('a simultaneous second click cannot submit twice', async () => {
    const { controller, actions } = setup();
    const first = controller.decide('submit', ['one']);
    expect(await controller.decide('submit', ['one'])).toBe(false);
    expect(await first).toBe(true);
    expect(actions.decide).toHaveBeenCalledTimes(1);
  });
  it('a failed save stops submission and requires explicit reload', async () => {
    const { controller, actions } = setup(true);
    controller.edit('one', { subject: 'Ready?', body: 'Changed' });
    expect(await controller.decide('submit', [])).toBe(false);
    expect(actions.decide.mock.calls.map(([call]) => call.action)).toEqual([
      'edit',
    ]);
    expect(await controller.decide('submit', [])).toBe(false);
    expect(actions.decide).toHaveBeenCalledTimes(1);
    expect(controller.error()).toContain('could not be saved');
  });
  it('serialized flushes cannot reuse a revision', async () => {
    const { controller, actions } = setup();
    controller.edit('one', { subject: 'Ready?', body: 'Yes' });
    expect(await Promise.all([controller.flush(), controller.flush()])).toEqual(
      [true, true]
    );
    expect(actions.decide).toHaveBeenCalledTimes(1);
  });
});

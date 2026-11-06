/** @vitest-environment jsdom */
import { ThrownResultError } from '@core/util/result';
import { INVALID_REVIEW_DECISION } from '@service-agent-harness/reviews';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Review, ReviewDecision } from '../core/review';
import { createReviewController } from './review-controller';

type EmailReview = Review & { kind: 'email' };

const initial: EmailReview = {
  id: 'review',
  sessionId: 'session',
  actingUser: 'macro|owner@macro.local',
  executionId: 'execution',
  presentedAt: null,
  decision: null,
  kind: 'email',
  title: 'Emails',
  revision: 0,
  updatedAt: 0,
  items: [
    {
      id: 'one',
      draft: { subject: 'Ready?', body: '', to: [{ email: 'a@example.com' }] },
      status: 'pending',
      error: null,
      result: null,
    },
    {
      id: 'two',
      draft: { subject: 'When?', body: '', to: [{ email: 'b@example.com' }] },
      status: 'pending',
      error: null,
      result: null,
    },
  ],
};
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function setup(
  fail = false,
  refuseSubmit?: (record: EmailReview) => string | undefined
) {
  let saved = structuredClone(initial);
  const actions = {
    reload: async (): Promise<Review> => structuredClone(saved),
    decide: vi.fn(async (decision: ReviewDecision): Promise<Review> => {
      if (fail || decision.revision !== saved.revision)
        throw new Error('conflict');
      const refusal =
        decision.action === 'submit' ? refuseSubmit?.(saved) : undefined;
      if (refusal)
        throw new ThrownResultError([
          { code: INVALID_REVIEW_DECISION, message: refusal },
        ]);
      saved = {
        ...saved,
        revision: saved.revision + 1,
        items: saved.items.map((item) => {
          if (decision.action === 'edit')
            return item.id === decision.item && decision.draft.kind === 'email'
              ? { ...item, draft: decision.draft.draft }
              : item;
          return decision.items.length === 0 || decision.items.includes(item.id)
            ? {
                ...item,
                status:
                  decision.action === 'submit' ? 'submitting' : 'dismissed',
              }
            : item;
        }),
      };
      return structuredClone(saved);
    }),
  };
  const controller = createRoot((dispose) => {
    cleanups.push(dispose);
    return createReviewController(() => initial, actions);
  });
  return { controller, actions };
}
describe('persisted review decisions', () => {
  it('adopts newer revisions, remounting editors only when their drafts change', async () => {
    const [source, update] = createSignal<EmailReview>(initial);
    const actions = {
      reload: async (): Promise<Review> => source(),
      decide: vi.fn(async (): Promise<Review> => source()),
    };
    const controller = createRoot((dispose) => {
      cleanups.push(dispose);
      return createReviewController(source, actions);
    });
    update({ ...initial, revision: 1, presentedAt: 100 });
    await Promise.resolve();
    expect(controller.stale()).toBe(false);
    expect(controller.record().presentedAt).toBe(100);
    expect(controller.generation()).toBe(0);
    update({
      ...source(),
      revision: 2,
      items: initial.items.map((item) => ({
        ...item,
        draft: { ...item.draft, subject: 'Changed elsewhere' },
      })),
    });
    await Promise.resolve();
    expect(controller.stale()).toBe(false);
    expect(controller.record().items[0].draft.subject).toBe(
      'Changed elsewhere'
    );
    expect(controller.generation()).toBe(1);
  });
  it('keeps unsaved local edits when another editor changes the draft', async () => {
    const [source, update] = createSignal<EmailReview>(initial);
    const actions = {
      reload: async (): Promise<Review> => source(),
      decide: vi.fn(() => new Promise<Review>(() => {})),
    };
    const controller = createRoot((dispose) => {
      cleanups.push(dispose);
      return createReviewController(source, actions);
    });
    controller.edit('one', {
      kind: 'email',
      draft: {
        subject: 'Ready?',
        body: 'Mine',
        to: [{ email: 'a@example.com' }],
      },
    });
    update({
      ...initial,
      revision: 1,
      items: initial.items.map((item) => ({
        ...item,
        draft: { ...item.draft, subject: 'Changed elsewhere' },
      })),
    });
    await Promise.resolve();
    expect(controller.stale()).toBe(true);
    expect(controller.generation()).toBe(0);
  });
  it('a poll returning its own in-flight save does not mark the review stale', async () => {
    const [source, update] = createSignal<EmailReview>({
      ...initial,
      revision: 1,
      presentedAt: 100,
    });
    let commit!: (record: Review) => void;
    let started!: () => void;
    const saving = new Promise<void>((resolve) => {
      started = resolve;
    });
    const actions = {
      reload: async (): Promise<Review> => source(),
      decide: vi.fn(
        () =>
          new Promise<Review>((resolve) => {
            commit = resolve;
            started();
          })
      ),
    };
    const controller = createRoot((dispose) => {
      cleanups.push(dispose);
      return createReviewController(source, actions);
    });
    const edited: EmailReview = {
      ...source(),
      revision: 2,
      items: [
        {
          ...initial.items[0],
          draft: {
            subject: 'Ready?',
            body: 'Yes',
            to: [{ email: 'a@example.com' }],
          },
        },
        initial.items[1],
      ],
    };
    controller.edit('one', { kind: 'email', draft: edited.items[0].draft });
    const flushed = controller.flush();
    await saving;

    update(edited);
    expect(controller.stale()).toBe(false);

    commit(edited);
    expect(await flushed).toBe(true);
    expect(controller.stale()).toBe(false);
    expect(controller.record().revision).toBe(2);

    update({
      ...edited,
      revision: 3,
      items: edited.items.map((item) => ({ ...item, status: 'dismissed' })),
    });
    await Promise.resolve();
    expect(controller.stale()).toBe(false);
    expect(controller.record().items[0].status).toBe('dismissed');
  });
  it('saves the latest edits before sending all, using the acknowledged revision', async () => {
    const { controller, actions } = setup();
    controller.edit('one', {
      kind: 'email',
      draft: {
        subject: 'Ready?',
        body: 'Yes',
        to: [{ email: 'a@example.com' }],
      },
    });
    controller.edit('two', {
      kind: 'email',
      draft: {
        subject: 'When?',
        body: 'Tomorrow',
        to: [{ email: 'b@example.com' }],
      },
    });
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
  it('shows a refused submission as validation without blocking the review', async () => {
    const { controller, actions } = setup(false, (record) =>
      record.items[1].draft.to.length === 0
        ? 'Add at least one recipient.'
        : undefined
    );
    controller.edit('two', {
      kind: 'email',
      draft: { subject: 'When?', body: '', to: [] },
    });
    expect(await controller.decide('submit', [])).toBe(false);
    expect(controller.validation()).toBe('Add at least one recipient.');
    expect(controller.error()).toBeUndefined();
    controller.edit('two', {
      kind: 'email',
      draft: { subject: 'When?', body: '', to: [{ email: 'b@example.com' }] },
    });
    expect(controller.validation()).toBeUndefined();
    expect(await controller.decide('submit', [])).toBe(true);
    expect(actions.decide.mock.calls.map(([call]) => call.action)).toEqual([
      'edit',
      'submit',
      'edit',
      'submit',
    ]);
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
    controller.edit('one', {
      kind: 'email',
      draft: {
        subject: 'Ready?',
        body: 'Changed',
        to: [{ email: 'a@example.com' }],
      },
    });
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
    controller.edit('one', {
      kind: 'email',
      draft: {
        subject: 'Ready?',
        body: 'Yes',
        to: [{ email: 'a@example.com' }],
      },
    });
    expect(await Promise.all([controller.flush(), controller.flush()])).toEqual(
      [true, true]
    );
    expect(actions.decide).toHaveBeenCalledTimes(1);
  });
});

import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputCapabilities } from '../context/capabilities';
import {
  emptyDraft,
  type Intent,
  intents,
  type Suggestions,
} from '../core/input';
import { createUniversalInput } from './universal-input';

const suggestions: Suggestions = {
  title: 'Call John',
  body: null,
  subject: null,
  recipients: [],
  query: null,
  start: '2026-10-10T15:00',
  end: '2026-10-10T16:00',
  due_date: null,
  location: null,
  guests: [],
};
function scored(intent: Intent) {
  return intents.map((i) => ({ intent: i, score: i === intent ? 0.96 : 0.05 }));
}
function source(overrides: Partial<InputCapabilities> = {}): InputCapabilities {
  return {
    classify: vi.fn(async (_text, revision) => ({
      revision,
      scores: scored('calendar'),
    })),
    extract: vi.fn(async (_text, intent, revision) => ({
      revision,
      intent,
      suggestions,
    })),
    submit: vi.fn(async () => ({ message: 'Created' })),
    validate: () => undefined,
    readDraft: () => undefined,
    saveDraft: vi.fn(),
    ...overrides,
  };
}
const cleanups: (() => void)[] = [];
function mount(capabilities = source()) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return createUniversalInput(capabilities);
  });
}
const tick = () => vi.advanceTimersByTimeAsync(501);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
  vi.useRealTimers();
});

describe('universal draft lifecycle', () => {
  it('debounces typing and extracts a timed calendar event without guests', async () => {
    const capabilities = source();
    const state = mount(capabilities);
    state.setText('Call John');
    state.setText('Call John at 3pm tomorrow');
    expect(capabilities.classify).not.toHaveBeenCalled();
    await tick();
    expect(capabilities.classify).toHaveBeenCalledOnce();
    expect(state.draft().intent).toBe('calendar');
    expect(state.fields().start).toBe('2026-10-10T15:00');
    expect(state.fields().guests).toBe('');
    expect(state.validation()).toBeUndefined();
  });
  it('keeps ambiguous input neutral', async () => {
    const state = mount(
      source({
        classify: async (_text, revision) => ({
          revision,
          scores: [
            { intent: 'task', score: 0.85 },
            { intent: 'calendar', score: 0.8 },
          ],
        }),
      })
    );
    state.setText('Call John');
    await tick();
    expect(state.draft().intent).toBeUndefined();
    expect(state.validation()).toBe('Choose a type');
  });
  it('locks on a field edit and preserves that field across later extraction', async () => {
    const capabilities = source();
    const state = mount(capabilities);
    state.setText('Call John at 3pm tomorrow');
    await tick();
    state.edit('title', 'Call Jane');
    state.setText('Call John at 4pm tomorrow');
    await tick();
    expect(state.draft().locked).toBe(true);
    expect(state.fields().title).toBe('Call Jane');
    expect(capabilities.classify).toHaveBeenCalledOnce();
    state.choose();
    await tick();
    expect(capabilities.classify).toHaveBeenCalledTimes(2);
    expect(state.fields().title).toBe('Call Jane');
  });
  it('ignores a stale classification after an explicit type choice', async () => {
    let resolve!: (result: {
      revision: number;
      scores: ReturnType<typeof scored>;
    }) => void;
    const capabilities = source({
      classify: vi.fn(
        () =>
          new Promise<{ revision: number; scores: ReturnType<typeof scored> }>(
            (r) => {
              resolve = r;
            }
          )
      ),
    });
    const state = mount(capabilities);
    state.setText('Call John');
    await tick();
    state.choose('email');
    await tick();
    resolve({ revision: 1, scores: scored('calendar') });
    await tick();
    expect(state.draft().intent).toBe('email');
    expect(state.pending()).toBe(false);
  });
  it('does not allow an older request to unblock submission during the next debounce', async () => {
    let resolve!: (result: {
      revision: number;
      scores: ReturnType<typeof scored>;
    }) => void;
    const capabilities = source({
      classify: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const state = mount(capabilities);
    state.setText('first');
    await tick();
    state.setText('new text');
    resolve({ revision: 1, scores: scored('ai') });
    await vi.advanceTimersByTimeAsync(1);
    expect(state.pending()).toBe(true);
    await state.submit();
    expect(capabilities.submit).not.toHaveBeenCalled();
  });
  it('allows manual completion after inference failure', async () => {
    const capabilities = source({
      classify: async () => {
        throw new Error('Offline');
      },
      extract: async () => {
        throw new Error('Offline');
      },
    });
    const state = mount(capabilities);
    state.setText('A note');
    await tick();
    state.choose('note');
    await tick();
    state.edit('title', 'A note');
    await tick();
    await state.submit();
    expect(capabilities.submit).toHaveBeenCalledOnce();
    expect(state.draft().text).toBe('');
  });
  it('does not get stuck pending when a queued draft is cleared', async () => {
    let resolve!: (value: {
      revision: number;
      scores: ReturnType<typeof scored>;
    }) => void;
    const capabilities = source({
      classify: vi.fn(
        () =>
          new Promise<{ revision: number; scores: ReturnType<typeof scored> }>(
            (r) => {
              resolve = r;
            }
          )
      ),
    });
    const state = mount(capabilities);
    state.setText('first');
    await tick();
    state.setText('second');
    await tick();
    state.setText('');
    resolve({ revision: 1, scores: scored('calendar') });
    await tick();
    expect(state.pending()).toBe(false);
    expect(state.draft()).toEqual(emptyDraft());
    expect(capabilities.classify).toHaveBeenCalledOnce();
    expect(capabilities.extract).not.toHaveBeenCalled();
  });
  it('removes stale suggested times after extraction fails while preserving edits', async () => {
    const capabilities = source();
    const state = mount(capabilities);
    state.setText('Call John at 3pm tomorrow');
    await tick();
    state.edit('title', 'My call');
    vi.mocked(capabilities.extract).mockRejectedValue(new Error('Offline'));
    state.setText('Call John at 4pm tomorrow');
    await tick();
    expect(state.fields().title).toBe('My call');
    expect(state.fields().start).toBe('');
    expect(state.validation()).toBe('Choose a valid start and end time');
    expect(capabilities.saveDraft).toHaveBeenLastCalledWith(state.draft());
  });
  it('restores the retry identity after reloading a failed submission', async () => {
    const capabilities = source({
      submit: vi.fn(async () => {
        throw new Error('Offline');
      }),
    });
    const first = mount(capabilities);
    first.setText('hello');
    first.choose('ai');
    await tick();
    await first.submit();
    const reloaded = mount(
      source({ readDraft: () => first.draft(), submit: capabilities.submit })
    );
    await tick();
    await reloaded.submit();
    const calls = vi.mocked(capabilities.submit).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].id).toBe(calls[1][0].id);
  });
  it('keeps the draft and retry identity on submission failure', async () => {
    const capabilities = source({
      submit: vi.fn(async () => {
        throw new Error('Failed');
      }),
    });
    const state = mount(capabilities);
    state.setText('hello');
    state.choose('ai');
    await tick();
    await state.submit();
    await state.submit();
    expect(state.draft().text).toBe('hello');
    const calls = vi.mocked(capabilities.submit).mock.calls;
    expect(calls[0][0].id).toBe(calls[1][0].id);
  });
  it('prevents double sends and edits during a submission', async () => {
    let complete!: () => void;
    const capabilities = source({
      submit: vi.fn(async () => {
        await new Promise<void>((r) => {
          complete = r;
        });
        return { message: 'Sent' };
      }),
    });
    const state = mount(capabilities);
    state.setText('hello');
    state.choose('ai');
    await tick();
    const first = state.submit();
    await state.submit();
    state.setText('changed');
    expect(state.draft().text).toBe('hello');
    expect(capabilities.submit).toHaveBeenCalledOnce();
    complete();
    await first;
    expect(state.draft().text).toBe('');
  });
  it('clears storage even when navigation unmounts the composer during submission', async () => {
    const capabilities = source({
      submit: async () => {
        cleanups.splice(0).forEach((fn) => fn());
        return { message: 'Opened' };
      },
    });
    const state = mount(capabilities);
    state.setText('hello');
    state.choose('ai');
    await tick();
    await state.submit();
    expect(capabilities.saveDraft).toHaveBeenLastCalledWith(emptyDraft());
  });
  it('restores locked drafts and clears all metadata when emptied', async () => {
    const saved = {
      ...emptyDraft(),
      text: 'hello',
      intent: 'email' as const,
      locked: true,
    };
    saved.fields.email.subject = 'Saved subject';
    saved.edited.email = ['subject'];
    const capabilities = source({ readDraft: () => saved });
    const state = mount(capabilities);
    await tick();
    expect(state.fields().subject).toBe('Saved subject');
    expect(capabilities.classify).not.toHaveBeenCalled();
    state.setText('');
    expect(state.draft()).toEqual(emptyDraft());
  });
});

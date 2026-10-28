import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchFiltersSchema } from '../../next-soup/core/search-filters';
import type { InputCapabilities } from '../context/capabilities';
import type { InputObservation } from '../context/telemetry';
import {
  emptyDraft,
  type Intent,
  intents,
  type SubmissionResult,
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
    saveEmailDraft: vi.fn(async () => ({ message: 'Email draft saved' })),
    validate: () => undefined,
    validateEmailDraft: () => undefined,
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

it('observes metadata only, skips unchanged edits, and clears the observed type after a classification failure', async () => {
  const events: InputObservation[] = [];
  const capabilities = source({ observe: (event) => events.push(event) });
  const state = mount(capabilities);
  state.setText('Private source text');
  await state.submit();
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'blocked', reason: 'pending' })
  );
  await tick();
  vi.mocked(capabilities.classify).mockRejectedValueOnce(
    new Error('Private failure detail')
  );
  state.setText('Private source text changed');
  await tick();
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'type', intent: undefined, manual: false })
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      event: 'prediction',
      outcome: 'error',
      failure: 'unknown',
    })
  );
  state.setText('Private source text recovered');
  await tick();
  state.edit('title', state.fields().title);
  expect(events.filter((event) => event.event === 'field')).toHaveLength(0);
  state.edit('title', 'Private field value');
  expect(events).toContainEqual(
    expect.objectContaining({ event: 'field', field: 'title', inferred: true })
  );
  expect(JSON.stringify(events)).not.toContain('Private');
});

describe('universal draft lifecycle', () => {
  it('does not attribute inferred fields from a cleared draft to the next draft', async () => {
    const observe = vi.fn();
    const state = mount(source({ observe }));
    state.setText('Schedule a meeting');
    await tick();
    state.setText('');
    state.setText('Another meeting');
    state.choose('calendar');
    state.edit('title', 'Manually selected title');
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'field',
        field: 'title',
        inferred: false,
      })
    );
  });
  it('saves an unfinished email only on an explicit action without sending it', async () => {
    const capabilities = source({ onSubmitted: vi.fn() });
    const state = mount(capabilities);
    state.setText('Email John');
    state.choose('email');
    state.edit('recipients', '');
    state.edit('subject', '');
    state.edit('body', '');
    await tick();
    expect(capabilities.saveEmailDraft).not.toHaveBeenCalled();
    expect(state.validation()).toBe('Choose a recipient');
    expect(state.emailDraftValidation()).toBeUndefined();
    await state.saveEmailDraft();
    expect(capabilities.saveEmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: 'email',
        fields: expect.objectContaining({
          recipients: '',
          subject: '',
          body: '',
        }),
      })
    );
    expect(capabilities.submit).not.toHaveBeenCalled();
    expect(state.draft().text).toBe('');
    expect(state.result()?.message).toBe('Email draft saved');
    expect(capabilities.onSubmitted).toHaveBeenCalledOnce();
  });
  it('preserves an email on draft-save failure and blocks duplicate saves in flight', async () => {
    let fail!: (reason: Error) => void;
    const capabilities = source({
      extract: async (_text, intent, revision) => ({
        intent,
        revision,
        suggestions: {
          ...suggestions,
          recipients: ['John'],
          subject: 'Running late',
          body: 'I will be late',
        },
      }),
      saveEmailDraft: vi.fn(
        () =>
          new Promise<SubmissionResult>((_resolve, reject) => {
            fail = reject;
          })
      ),
    });
    const state = mount(capabilities);
    state.setText('Email John that I will be late');
    state.choose('email');
    await tick();
    expect(state.validation()).toBeUndefined();
    const save = state.saveEmailDraft();
    expect(state.savingEmailDraft()).toBe(true);
    await state.saveEmailDraft();
    await state.submit();
    expect(capabilities.saveEmailDraft).toHaveBeenCalledOnce();
    expect(capabilities.submit).not.toHaveBeenCalled();
    fail(new Error('Could not save draft'));
    await save;
    expect(state.draft().text).toBe('Email John that I will be late');
    expect(state.error()).toBe('Could not save draft');
    expect(state.sending()).toBe(false);
  });
  it('extracts search filters and keeps manual query edits through later predictions', async () => {
    const capabilities = source({
      classify: vi.fn(async (_text, revision) => ({
        revision,
        scores: scored('search'),
      })),
      extract: vi.fn(async (_text, intent, revision) => ({
        intent,
        revision,
        suggestions: {
          query: 'growth in 2026',
          recipients: [],
          guests: [],
          searchFilters: searchFiltersSchema.parse({
            type: 'channels',
            channels: { in: ['sales'], from: ['Julia'] },
          }),
        },
      })),
    });
    const state = mount(capabilities);
    state.setText('search messages from Julia in sales about growth in 2026');
    expect(state.draft().intent).toBeUndefined();
    await tick();
    expect(capabilities.extract).toHaveBeenCalled();
    expect(state.fields().query).toBe('growth in 2026');
    expect(JSON.parse(state.fields().searchFilters).channels.in).toEqual([
      'sales',
    ]);
    state.edit('query', 'budget');
    state.setText('search messages from Alex about forecast');
    await tick();
    expect(state.fields().query).toBe('budget');
  });
  it('keeps a manually chosen search type in later extraction requests', async () => {
    const capabilities = source({
      classify: vi.fn(async (_text, revision) => ({
        revision,
        scores: scored('search'),
      })),
    });
    const state = mount(capabilities);
    state.setText('search messages from Julia about android');
    await tick();
    state.edit(
      'searchFilters',
      JSON.stringify(searchFiltersSchema.parse({ type: 'task' }))
    );
    state.setText('search messages from Julia about android updates');
    await tick();
    expect(capabilities.extract).toHaveBeenLastCalledWith(
      'search messages from Julia about android updates',
      'search',
      expect.any(Number),
      'task'
    );
    expect(JSON.parse(state.fields().searchFilters).type).toBe('task');
  });
  it('pauses search after failed filter extraction until both fields are explicitly chosen', async () => {
    const extract = vi.fn(
      async (_text: string, intent: Intent, revision: number) => ({
        intent,
        revision,
        suggestions: {
          query: 'budget',
          recipients: [],
          guests: [],
          searchFilters: searchFiltersSchema.parse({
            type: 'channels',
            channels: { from: ['Julia'], in: [] },
          }),
        },
      })
    );
    const capabilities = source({ extract });
    const state = mount(capabilities);
    state.setText('search messages from Julia about budget');
    state.choose('search');
    expect(state.pending()).toBe(true);
    await tick();
    expect(state.pending()).toBe(false);
    extract.mockRejectedValue(new Error('Extraction unavailable'));
    state.edit('query', 'forecast');
    await tick();
    expect(state.pending()).toBe(true);
    await state.submit();
    expect(capabilities.submit).not.toHaveBeenCalled();
    state.edit(
      'searchFilters',
      JSON.stringify(
        searchFiltersSchema.parse({
          type: 'channels',
          channels: { from: ['Julia'], in: [] },
        })
      )
    );
    await tick();
    expect(state.pending()).toBe(false);
    expect(state.fields().query).toBe('forecast');
    expect(JSON.parse(state.fields().searchFilters).channels.from).toEqual([
      'Julia',
    ]);
    await state.submit();
    expect(capabilities.submit).toHaveBeenCalledOnce();
  });
  it('reveals the classified form and preserves edits while model fields arrive', async () => {
    const capabilities = source({
      classify: vi.fn(async (_text, revision) => ({
        revision,
        scores: scored('email'),
      })),
      extract: vi.fn(async (_text, intent, revision) => ({
        intent,
        revision,
        suggestions: {
          ...suggestions,
          body: 'Model body',
          subject: 'Model subject',
          recipients: ['Julia'],
        },
      })),
    });
    const state = mount(capabilities);
    state.setText('email Julia about the report that failed');
    expect(state.draft().intent).toBeUndefined();
    state.choose('email');
    expect(state.fields().body).toBe(
      'email Julia about the report that failed'
    );
    expect(state.fields().recipients).toBe('');
    state.edit('body', 'My outgoing message');
    state.edit('recipients', 'Julia Roberts');
    state.setText('email Alex about another report');
    await tick();
    expect(state.fields().body).toBe('My outgoing message');
    expect(state.fields().recipients).toBe('Julia Roberts');
    expect(state.fields().subject).toBe('Model subject');
  });
  it('continues classification while extraction runs, coalesces each queue, and rejects stale fields', async () => {
    type Extracted = Awaited<ReturnType<InputCapabilities['extract']>>;
    const requests: {
      text: string;
      intent: Intent;
      revision: number;
      resolve(value: Extracted): void;
    }[] = [];
    const capabilities = source({
      classify: vi.fn(async (text, revision) => ({
        revision,
        scores: scored(text === 'bug' ? 'task' : 'note'),
      })),
      extract: vi.fn(
        (text, intent, revision) =>
          new Promise<Extracted>((resolve) =>
            requests.push({ text, intent, revision, resolve })
          )
      ),
    });
    const state = mount(capabilities);
    state.setText('bug');
    await tick();
    expect(requests).toHaveLength(1);
    state.setText('outline one');
    state.setText('outline two');
    state.setText('outline latest');
    await tick();
    expect(capabilities.classify).toHaveBeenCalledTimes(2);
    expect(capabilities.classify).toHaveBeenLastCalledWith('outline latest', 4);
    expect(state.draft().intent).toBe('note');
    expect(state.fields().body).toBe('outline latest');
    expect(requests).toHaveLength(1);
    requests[0].resolve({
      revision: requests[0].revision,
      intent: 'task',
      suggestions: { ...suggestions, title: 'Stale task' },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      text: 'outline latest',
      intent: 'note',
      revision: 4,
    });
    expect(state.fields().title).toBe('outline latest');
    expect(state.pending()).toBe(true);
    await state.submit();
    expect(capabilities.submit).not.toHaveBeenCalled();
    requests[1].resolve({
      revision: 4,
      intent: 'note',
      suggestions: { ...suggestions, title: 'Outline', body: 'outline latest' },
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(state.pending()).toBe(false);
    expect(state.fields().title).toBe('Outline');
  });
  it.each([
    'Email notifications not working\npriority urgent',
    'Find and fix notification bug',
  ])(
    'uses the classifier rather than a command-prefix guess for %s',
    async (text) => {
      const capabilities = source({
        classify: vi.fn(async (_text, revision) => ({
          revision,
          scores: scored('task'),
        })),
      });
      const state = mount(capabilities);
      state.setText(text);
      expect(state.draft().intent).toBeUndefined();
      await tick();
      expect(state.draft().intent).toBe('task');
      expect(capabilities.extract).toHaveBeenLastCalledWith(text, 'task', 1);
    }
  );
  it('retries a failed email without invalidating its completed inference or retry identity', async () => {
    const capabilities = source({
      extract: vi.fn(async (_text, intent, revision) => ({
        intent,
        revision,
        suggestions: {
          ...suggestions,
          subject: 'Hello',
          body: 'Hello',
          recipients: ['Julia'],
        },
      })),
      submit: vi.fn(async () => {
        throw new Error('Offline');
      }),
    });
    const state = mount(capabilities);
    state.setText('email Julia\nHello');
    await tick();
    await state.submit();
    expect(state.pending()).toBe(false);
    await state.submit();
    expect(capabilities.submit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(capabilities.submit).mock.calls[0][0].id).toBe(
      vi.mocked(capabilities.submit).mock.calls[1][0].id
    );
    expect(capabilities.extract).toHaveBeenCalledOnce();
  });
  it('notifies the host to focus only after a successful send has cleared and enabled the input', async () => {
    const onSubmitted = vi.fn(() => {
      expect(state.sending()).toBe(false);
      expect(state.draft().text).toBe('');
    });
    const capabilities = source({ onSubmitted });
    const state = mount(capabilities);
    state.setText('hello');
    state.choose('ai');
    await tick();
    await state.submit();
    expect(onSubmitted).toHaveBeenCalledOnce();
    vi.mocked(capabilities.submit).mockRejectedValue(new Error('Offline'));
    state.setText('next');
    state.choose('ai');
    await tick();
    await state.submit();
    expect(onSubmitted).toHaveBeenCalledOnce();
  });
  it('coalesces rapid typing and extracts a timed calendar event without guests', async () => {
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
  it('extracts the most likely draft immediately when scores are close', async () => {
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
    expect(state.draft().intent).toBe('task');
    expect(state.fields().title).toBe('Call John');
    expect(state.validation()).toBeUndefined();
    expect(state.draft().locked).toBe(false);
  });
  it('cycles ranked types, wraps, and preserves edits across shape changes', async () => {
    const capabilities = source({
      classify: vi.fn(async (_text: string, revision: number) => ({
        revision,
        scores: [
          { intent: 'note' as const, score: 0.7 },
          { intent: 'task' as const, score: 0.72 },
          { intent: 'ai' as const, score: 0.1 },
        ],
      })),
    });
    const state = mount(capabilities);
    state.setText('user unable to click on notification\npriority: high');
    await tick();
    expect(state.draft().intent).toBe('task');
    state.edit('title', 'Fix notification clicks');
    state.cycle();
    expect(state.draft().intent).toBe('note');
    expect(state.draft().locked).toBe(true);
    await tick();
    expect(capabilities.extract).toHaveBeenLastCalledWith(
      state.draft().text,
      'note',
      expect.any(Number)
    );
    state.cycle();
    expect(state.draft().intent).toBe('ai');
    state.cycle();
    expect(state.draft().intent).toBe('task');
    await tick();
    expect(state.fields().title).toBe('Fix notification clicks');
    state.cycle(-1);
    expect(state.draft().intent).toBe('ai');
    expect(capabilities.classify).toHaveBeenCalledOnce();
    expect(capabilities.submit).not.toHaveBeenCalled();
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
  it('does not allow an older prediction to unblock submission before the latest text settles', async () => {
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
  it('predicts during continuous typing and uses the latest text for extraction', async () => {
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
    state.setText('user');
    await vi.advanceTimersByTimeAsync(100);
    state.setText('user unable');
    await vi.advanceTimersByTimeAsync(100);
    expect(capabilities.classify).toHaveBeenCalledWith('user unable', 2);
    state.setText('user unable to click');
    resolve({ revision: 2, scores: scored('task') });
    await vi.advanceTimersByTimeAsync(1);
    expect(state.draft().intent).toBe('task');
    expect(capabilities.extract).toHaveBeenCalledWith(
      'user unable to click',
      'task',
      3
    );
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
  });
  it('preserves an explicitly supplied retry identity', async () => {
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
      source({ initialDraft: first.draft(), submit: capabilities.submit })
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
  it('accepts an initial locked draft and clears metadata when emptied', async () => {
    const saved = {
      ...emptyDraft(),
      text: 'hello',
      intent: 'email' as const,
      locked: true,
    };
    saved.fields.email.subject = 'Saved subject';
    saved.edited.email = ['subject'];
    const capabilities = source({ initialDraft: saved });
    const state = mount(capabilities);
    await tick();
    expect(state.fields().subject).toBe('Saved subject');
    expect(capabilities.classify).not.toHaveBeenCalled();
    state.setText('');
    expect(state.draft()).toEqual(emptyDraft());
  });
});

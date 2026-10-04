import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDraft } from '../component/types';
import {
  clearAutomationComposerDraft,
  loadAutomationComposerDraft,
  saveAutomationComposerDraft,
} from './automationComposerStorage';

const storageKey = 'automation-composer-draft';
const expiry = 3 * 60 * 1000;
const agentId = '0195a096-3d24-7000-8000-000000000001';
const draft: ScheduleDraft = {
  name: '',
  prompt: 'Unfinished instructions ',
  frequency: 'week',
  time: '09:00',
  daysOfWeek: [],
  dayOfMonth: '',
  target: { kind: 'model', model: 'retired-model' },
};

function store(value: unknown): void {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('automation composer storage', () => {
  it('returns null for empty storage and clears saved drafts', () => {
    expect(loadAutomationComposerDraft()).toBeNull();
    saveAutomationComposerDraft(draft);
    clearAutomationComposerDraft();
    expect(loadAutomationComposerDraft()).toBeNull();
  });

  it.each<ScheduleDraft['target']>([
    { kind: 'model', model: 'retired-model' },
    { kind: 'agent', agentId },
    { kind: 'agent', agentId, modelOverride: 'runtime/custom' },
  ])('round trips targets without a catalog: %j', (target) => {
    const saved = { ...draft, target };
    saveAutomationComposerDraft(saved);
    expect(loadAutomationComposerDraft()).toEqual(saved);
  });

  it('retains the draft activation choice', () => {
    store({ draft: { ...draft, enabled: false }, timestamp: Date.now() });
    expect(loadAutomationComposerDraft()).toEqual({ ...draft, enabled: false });
  });

  it('migrates an unexpired legacy model without refreshing its expiry', () => {
    const { target: _target, ...fields } = draft;
    store({
      draft: { ...fields, model: 'removed-from-catalog', enabled: true },
      timestamp: Date.now(),
    });
    vi.advanceTimersByTime(expiry);
    expect(loadAutomationComposerDraft()).toEqual({
      ...fields,
      enabled: true,
      target: { kind: 'model', model: 'removed-from-catalog' },
    });
    vi.advanceTimersByTime(1);
    expect(loadAutomationComposerDraft()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('retains drafts at the expiry boundary, then removes them', () => {
    saveAutomationComposerDraft(draft);
    vi.advanceTimersByTime(expiry);
    expect(loadAutomationComposerDraft()).toEqual(draft);
    vi.advanceTimersByTime(1);
    expect(loadAutomationComposerDraft()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    null,
    [],
    {},
    { draft },
    { draft, timestamp: 'today' },
    { draft, timestamp: null },
    { draft, timestamp: -1 },
    { draft: null, timestamp: 0 },
  ])('clears malformed envelopes: %j', (payload) => {
    store(payload);
    expect(loadAutomationComposerDraft()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it.each([
    { target: null },
    { target: { kind: 'model', model: '' } },
    { target: { kind: 'agent', agentId: 'invalid' } },
    { target: { kind: 'agent', agentId, modelOverride: 42 } },
    { target: { kind: 'agent', agentId, modelOverride: null } },
    { target: { kind: 'future' }, model: 'do-not-fallback' },
    { target: undefined },
    { target: undefined, model: '' },
    { prompt: null },
    { name: 42 },
    { frequency: 'daily' },
    { time: 9 },
    { daysOfWeek: '2' },
    { daysOfWeek: [2] },
    { dayOfMonth: 1 },
    { enabled: 'true' },
    { id: 42 },
  ])(
    'clears malformed drafts without silently changing their selection: %j',
    (fields) => {
      store({ draft: { ...draft, ...fields }, timestamp: Date.now() });
      expect(loadAutomationComposerDraft()).toBeNull();
      expect(localStorage.getItem(storageKey)).toBeNull();
    }
  );

  it('handles invalid JSON and inaccessible storage', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(storageKey, '{');
    expect(loadAutomationComposerDraft()).toBeNull();
    expect(localStorage.getItem(storageKey)).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Unavailable');
    });
    expect(loadAutomationComposerDraft()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    expect(() => saveAutomationComposerDraft(draft)).not.toThrow();
  });
});

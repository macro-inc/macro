import type { RoutineSuggestion } from '@service-scheduled-action/generated/schemas';
import { describe, expect, it } from 'vitest';
import { onboardingSuggestions, preselectedSuggestions } from './routine-picks';

const starter = (
  id: string,
  keepProbability: number,
  safeDefault: boolean
): RoutineSuggestion => ({
  id,
  kind: 'starter',
  key: id,
  knobs: {},
  surface: 'email',
  reason: 'Fits.',
  keepProbability,
  safeDefault,
});

const request = (id: string, keepProbability: number): RoutineSuggestion => ({
  id,
  kind: 'request',
  title: 'Forward my mail',
  request: 'Forward every new email.',
  surface: 'email',
  reason: 'Fits.',
  keepProbability,
  // A request is never safe by default; this one claims to be anyway.
  safeDefault: true,
});

describe('onboarding routine picks', () => {
  it('switch on only catalog routines marked safe, however sure AI is about the rest', () => {
    const suggestions = [
      starter('tags', 0.95, true),
      starter('updates', 0.99, false),
      request('forward', 1),
      starter('inbox', 0.85, true),
    ];
    expect(preselectedSuggestions(suggestions)).toEqual(['tags', 'inbox']);
    expect(onboardingSuggestions(suggestions).map((s) => s.id)).toEqual([
      'tags',
      'updates',
      'inbox',
    ]);
  });

  it('switch on at least two and at most five', () => {
    expect(
      preselectedSuggestions([
        starter('a', 0.3, true),
        starter('b', 0.5, true),
        starter('c', 0.1, true),
      ])
    ).toEqual(['b', 'a']);
    const confident = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) =>
      starter(id, 0.9 - index * 0.01, true)
    );
    expect(preselectedSuggestions(confident)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(preselectedSuggestions([])).toEqual([]);
  });
});

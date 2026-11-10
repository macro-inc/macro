import type { RoutineSuggestionsQuery } from '@service-storage/graphql/generated/graphql';
import { expect, it } from 'vitest';
import { mapRoutineSuggestions } from './routine-suggestions';

type Answer = NonNullable<
  RoutineSuggestionsQuery['user']['routineSuggestions']
>;

const suggestion = (
  id: string,
  state: 'OPEN' | 'DISMISSED'
): Answer['suggestions'][number] => ({
  id,
  from: 'FOR_YOU',
  surfaces: ['EMAIL', 'AGENTS'],
  reason: 'You answer most mail within a day.',
  keepProbability: 0.9,
  onByDefault: true,
  state,
  pick: {
    __typename: 'GraphqlCatalogRoutinePick',
    key: 'email_tags',
    knobs: { days: 14 },
  },
});

const answered = (
  routineSuggestions: Answer | null
): RoutineSuggestionsQuery => ({
  user: { id: 'user', routineSuggestions },
});

it('leaves out a suggestion the cache holds as dismissed', () => {
  const mapped = mapRoutineSuggestions(
    answered({
      status: 'GENERATING',
      suggestions: [
        suggestion('kept', 'OPEN'),
        suggestion('gone', 'DISMISSED'),
      ],
    })
  );

  expect(mapped).toEqual({
    status: 'generating',
    suggestions: [
      {
        id: 'kept',
        kind: 'catalog',
        key: 'email_tags',
        knobs: { days: 14 },
        from: 'for_you',
        surfaces: ['email', 'agents'],
        reason: 'You answer most mail within a day.',
        keepProbability: 0.9,
        onByDefault: true,
      },
    ],
  });
});

it('answers nothing while suggestions are off for the user', () => {
  expect(mapRoutineSuggestions(answered(null))).toBeUndefined();
});

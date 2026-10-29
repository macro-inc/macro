import { describe, expect, it } from 'vitest';
import {
  pickDefaultOn,
  type RoutineSuggestion,
  suggestionToDraft,
} from './suggestions';

function raw(overrides: Partial<RoutineSuggestion>): RoutineSuggestion {
  const surface = overrides.surface ?? 'email';
  const title = overrides.title ?? 'Tag invoices';
  return {
    id: JSON.stringify([surface, title.toLowerCase()]),
    surface: 'email',
    title: 'Tag invoices',
    summary: 'Labels invoices as they arrive.',
    reason: 'You get invoices from Acme weekly',
    instructions: 'Label every invoice from Acme as Finance.',
    icon: 'tag',
    keepProbability: 0.5,
    affectsOthers: false,
    notify: false,
    trigger: {
      id: 'trigger-1',
      kind: 'event',
      events: ['email.message_received'],
      condition: 'Is this email an invoice?',
    },
    when: 'When a new email arrives',
    ...overrides,
  };
}

describe('suggestionToDraft', () => {
  it('creates an enabled routine that shows its runs when it notifies', () => {
    const suggestion = raw({ notify: true });
    const draft = suggestionToDraft(suggestion, {
      kind: 'agent',
      agentId: '0198c7a3-0000-7000-8000-000000000001',
    });
    expect(draft).toMatchObject({
      name: 'Tag invoices',
      prompt: 'Label every invoice from Acme as Finance.',
      enabled: true,
      runVisibility: 'listed',
      target: {
        kind: 'agent',
        agentId: '0198c7a3-0000-7000-8000-000000000001',
      },
    });
    expect(draft.triggers?.[0]?.id).not.toBe(suggestion.trigger.id);
  });
});

describe('pickDefaultOn', () => {
  const titled = (probabilities: number[]) =>
    probabilities.map((keepProbability, index) =>
      raw({
        surface: (['email', 'tasks', 'crm'] as const)[index % 3],
        title: `Routine ${index}`,
        keepProbability,
      })
    );
  const titlesOf = (
    suggestions: ReturnType<typeof titled>,
    ids: ReadonlySet<string>
  ) =>
    suggestions
      .filter((suggestion) => ids.has(suggestion.id))
      .map((suggestion) => suggestion.title);

  it('turns on every likely keeper, up to five, most likely first', () => {
    const three = titled([0.5, 0.92, 0.81, 0.3, 0.8, 0.79]);
    expect(titlesOf(three, pickDefaultOn(three))).toEqual([
      'Routine 1',
      'Routine 2',
      'Routine 4',
    ]);
    const many = titled([0.9, 0.95, 0.85, 0.99, 0.81, 0.8, 0.97]);
    expect(pickDefaultOn(many).size).toBe(5);
    expect(pickDefaultOn(many).has(many[5].id)).toBe(false);
  });

  it('tops up to two with the next most likely when few clear the bar', () => {
    const unsure = titled([0.2, 0.6, 0.85, 0.55]);
    expect(titlesOf(unsure, pickDefaultOn(unsure))).toEqual([
      'Routine 1',
      'Routine 2',
    ]);
    expect(pickDefaultOn(titled([0.4])).size).toBe(1);
    expect(pickDefaultOn([]).size).toBe(0);
  });

  it('never turns on a routine that affects other people', () => {
    const suggestions = [
      raw({
        title: 'Post updates',
        keepProbability: 0.99,
        affectsOthers: true,
      }),
      raw({ title: 'Tag mail', keepProbability: 0.3 }),
      raw({ title: 'Digest', keepProbability: 0.2 }),
    ];
    expect(
      suggestions
        .filter((suggestion) => pickDefaultOn(suggestions).has(suggestion.id))
        .map((suggestion) => suggestion.title)
    ).toEqual(['Tag mail', 'Digest']);
  });
});

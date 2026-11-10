import { describe, expect, it, vi } from 'vitest';
import { withKnobValue } from '../../routines/core/knobs';
import { context, drafted, forYou, TAGS, template } from '../tests/fixtures';
import {
  discoverItems,
  draftWithEdits,
  type SuggestionItem,
  stackLooks,
  suggestionAction,
  suggestionItem,
  suggestionLook,
  suggestionSentence,
  suggestionsFor,
  templateItem,
  withEnabledInPlace,
} from './suggestions';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

describe('catalog suggestions', () => {
  it('save the catalog routine with AI’s knob values, switched on and pointing back at it', () => {
    const item = suggestionItem(forYou, [TAGS], context(true));
    expect(item).toMatchObject({
      title: 'Tag new email',
      summary: 'Tag each new email Respond within 14 days.',
      reason: 'You answer most mail within a day.',
      template: false,
      catalogKey: 'email_tags',
      surfaces: ['email', 'agents'],
      needsPersonalTags: true,
      reviewFirst: false,
      draft: { enabled: true, suggestionId: 'pick-1' },
    });
    const [step] = item?.draft.steps ?? [];
    expect(step?.kind === 'code' && step.knobs).toMatchObject([
      { name: 'replyTag', value: 'Respond' },
      { name: 'days', value: 14 },
    ]);
    expect(item && suggestionAction(item)).toBe('turn-on');
  });

  it('show their sentence with AI’s values, and save the values the person picks', () => {
    const item = required(suggestionItem(forYou, [TAGS], context(true)));
    const sentence = required(suggestionSentence(item, {}));
    expect(sentence.sentence).toBe(
      'Tag each new email {replyTag} within {days} days.'
    );
    const knobs = withKnobValue(sentence.knobs, 'days', 3);
    expect(suggestionSentence(item, { knobs })?.knobs).toBe(knobs);
    const draft = draftWithEdits(item, { knobs });
    expect(draft).toMatchObject({
      description: 'Tag each new email Respond within 3 days.',
      suggestionId: 'pick-1',
    });
    const [step] = draft.steps ?? [];
    expect(step?.kind === 'code' && step.knobs).toBe(knobs);
    // Nothing changed: the routine AI suggested, as it is.
    expect(draftWithEdits(item, {})).toBe(item.draft);
  });

  it('read as their summary where code can’t be saved, and open in the editor when Macro’s', () => {
    const item = required(suggestionItem(template, [TAGS], context(false)));
    expect(item.reason).toBeUndefined();
    expect(item.needsPersonalTags).toBe(false);
    expect(suggestionSentence(item, {})).toBeUndefined();
    expect(item.summary).toBe('AI tags new email Reply or FYI');
    expect(suggestionAction(item)).toBe('use');
  });

  it('are left out until the catalog has them', () => {
    expect(suggestionItem(forYou, [], context(true))).toBeUndefined();
  });
});

describe('drafted suggestions', () => {
  it('open for review with the drafted routine, switched on once saved', () => {
    const item = suggestionItem(drafted, [], context(true));
    expect(item).toMatchObject({
      title: 'Supplier digest',
      summary: 'Every Friday, list the deliveries suppliers confirmed.',
      reason: 'Suppliers write every week.',
      chain: { action: 'Ask AI', actionAi: true },
      reviewFirst: true,
      draft: {
        name: 'Supplier digest',
        enabled: true,
        suggestionId: 'drafted-1',
      },
    });
    expect(item?.draft.id).toBeUndefined();
    expect(item && suggestionAction(item)).toBe('review');
  });
});

describe('templates beside the suggestions', () => {
  it('start from the catalog routine, pointing at no suggestion', () => {
    const item = templateItem(TAGS, context(true));
    expect(item).toMatchObject({
      id: 'template:email_tags',
      from: 'macro',
      template: true,
      title: 'Tag new email',
      summary: 'Tag each new email Reply within 7 days.',
      chain: { action: 'Tag with AI', actionAi: true },
    });
    expect(item.draft.suggestionId).toBeUndefined();
    expect(suggestionAction(item)).toBe('use');
  });

  it('come after AI’s picks and Macro’s suggestions, unless one already offers them', () => {
    const pick = required(suggestionItem(forYou, [TAGS], context(true)));
    const macro = required(suggestionItem(template, [TAGS], context(true)));
    const drafts = required(suggestionItem(drafted, [], context(true)));
    const tags = templateItem(TAGS, context(true));
    const brief = {
      ...templateItem(TAGS, context(true)),
      id: 'template:brief',
      catalogKey: 'brief',
    };
    expect(
      discoverItems([macro, pick, drafts], [tags, brief]).map((item) => item.id)
    ).toEqual(['pick-1', 'drafted-1', 'template-1', 'template:brief']);
  });
});

describe('card icons', () => {
  const card = (
    surfaces: SuggestionItem['surfaces'],
    scheduled = false
  ): Pick<SuggestionItem, 'surfaces' | 'draft'> => ({
    surfaces,
    draft: {
      ...required(suggestionItem(forYou, [TAGS], context(true))).draft,
      triggers: scheduled
        ? [{ kind: 'schedule', cron: '0 9 * * 5', timezone: 'UTC' } as never]
        : [],
    },
  });

  it('differ in a sidebar by what each routine works in besides it', () => {
    expect(suggestionLook(card(['email', 'tasks']), 'email')).toBe('tasks');
    expect(suggestionLook(card(['email', 'agents']), 'email')).toBe('email');
    expect(suggestionLook(card(['email'], true), 'email')).toBe('calendar');
    expect(suggestionLook(card(['email']), 'email')).toBe('email');
    expect(suggestionLook(card(['agents'], true), 'agents')).toBe('calendar');
  });

  it('stack up to three different ones on the sidebar card', () => {
    expect(
      stackLooks(
        [
          card(['email', 'agents']),
          card(['email']),
          card(['email', 'tasks']),
          card(['email'], true),
          card(['email', 'crm']),
        ],
        'email'
      )
    ).toEqual(['email', 'tasks', 'calendar']);
  });

  it('show the part of the app a routine belongs to most elsewhere', () => {
    expect(suggestionLook(card(['email', 'tasks']))).toBe('email');
    expect(suggestionLook(card([]))).toBe('agents');
  });
});

describe('suggestion lists', () => {
  it('show a suggestion in every sidebar it names', () => {
    const items = [
      { id: 'a', surfaces: ['email', 'agents'] },
      { id: 'b', surfaces: ['crm'] },
    ];
    expect(suggestionsFor(items, 'agents')?.map((item) => item.id)).toEqual([
      'a',
    ]);
    expect(suggestionsFor(undefined, 'email')).toBeUndefined();
  });

  it('keep a row enabled here below the rows that were above it once the server drops it', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const d = { id: 'd' };
    expect(
      withEnabledInPlace([a, b, d], [{ item: c, above: ['a', 'b'] }])
    ).toEqual([a, b, c, d]);
    // The row right above it was dismissed: it stays below the next one up.
    expect(
      withEnabledInPlace([a, d], [{ item: c, above: ['a', 'b'] }])
    ).toEqual([a, c, d]);
    expect(withEnabledInPlace([d], [{ item: a, above: [] }])).toEqual([a, d]);
    // Still listed: not added twice.
    expect(withEnabledInPlace([a, c], [{ item: c, above: ['a'] }])).toEqual([
      a,
      c,
    ]);
  });
});

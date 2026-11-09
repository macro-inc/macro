import { describe, expect, it, vi } from 'vitest';
import { context, drafted, forYou, TAGS, template } from '../tests/fixtures';
import {
  draftWithEdits,
  initialEdits,
  suggestionByline,
  suggestionItem,
  suggestionsFor,
  withEnabledInPlace,
} from './suggestions';

vi.mock(
  '@property/identifiers',
  async () => await vi.importActual('@property/identifiers')
);
vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: () => 'New routine',
}));

describe('suggestion bylines', () => {
  it('say who suggests it: AI with its reason, or Macro with none', () => {
    expect(suggestionByline('for_you', 'You file a lot of mail.')).toBe(
      'For you · You file a lot of mail.'
    );
    expect(suggestionByline('for_you', null)).toBe('For you');
    expect(suggestionByline('macro', 'ignored')).toBe('Template from Macro');
  });
});

describe('catalog suggestions', () => {
  it('save the catalog routine with AI’s knob values, switched on and pointing back at it', () => {
    const item = suggestionItem(forYou, [TAGS], context(true));
    expect(item).toMatchObject({
      title: 'Tag new email',
      summary: 'Tag each new email Respond within 14 days.',
      byline: 'For you · You answer most mail within a day.',
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
    // Code isn't editable from the row; only its name and notifications are.
    expect(item && initialEdits(item).instructions).toBeUndefined();
  });

  it('use the Ask AI instructions where code can’t be saved, editable from the row', () => {
    const item = suggestionItem(template, [TAGS], context(false));
    expect(item?.byline).toBe('Template from Macro');
    expect(item?.needsPersonalTags).toBe(false);
    if (!item) throw new Error('expected an item');
    const edits = initialEdits(item);
    expect(edits.instructions).toBe('Tag this email.');
    expect(
      draftWithEdits(item, {
        title: '  My tags ',
        instructions: 'Tag it my way.',
        notify: true,
      })
    ).toMatchObject({
      name: 'My tags',
      prompt: 'Tag it my way.',
      runVisibility: 'listed',
      suggestionId: 'template-1',
    });
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
      byline: 'For you · Suppliers write every week.',
      reviewFirst: true,
      draft: {
        name: 'Supplier digest',
        enabled: true,
        suggestionId: 'drafted-1',
      },
    });
    expect(item?.draft.id).toBeUndefined();
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

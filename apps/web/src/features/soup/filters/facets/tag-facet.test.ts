import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import { describe, expect, it } from 'vitest';
import { compileFacets } from './compile';
import { testFacets } from './evaluate';
import {
  createTagFacetContext,
  EMPTY_TAG_FACET_CONTEXT,
  TAG_FACET_ID,
  tagFacetOption,
  tagFacetReady,
} from './tag-facet';
import type { Facet } from './types';

const TAG_SETS = [
  {
    scope: 'user',
    definition: { id: 'personal-definition' },
    options: [
      {
        id: 'urgent',
        propertyDefinitionId: 'personal-definition',
        displayOrder: 0,
        value: { type: 'string', value: 'Urgent' },
      },
    ],
  },
  {
    scope: 'team',
    definition: { id: 'team-definition' },
    options: [
      {
        id: 'launch',
        propertyDefinitionId: 'team-definition',
        displayOrder: 0,
        value: { type: 'string', value: 'Launch' },
      },
    ],
  },
] as TagSetResponse[];

type Item = { properties?: SoupProperty[] };

const tagged = (...optionIds: string[]): Item => ({
  properties: [
    {
      id: 'assignment',
      definition: { id: 'personal-definition' },
      value: { type: 'SelectOption', value: optionIds },
    } as SoupProperty,
  ],
});

const TAG_FACET: Facet<Item, ReturnType<typeof createTagFacetContext>> = {
  id: TAG_FACET_ID,
  mode: 'or',
  options: (optionId, context) => tagFacetOption<Item>(optionId, context),
};

describe('createTagFacetContext', () => {
  it('maps every option across sets to the definition that owns it', () => {
    const context = createTagFacetContext(TAG_SETS);

    expect([...context.tagPropertyDefinitionByOptionId]).toEqual([
      ['urgent', 'personal-definition'],
      ['launch', 'team-definition'],
    ]);
  });
});

describe('tagFacetOption', () => {
  const context = createTagFacetContext(TAG_SETS);

  it('resolves a known tag to its definition and option', () => {
    const option = tagFacetOption<Item>('launch', context);

    expect(option?.propertyDefinitionId).toBe('team-definition');
    expect(option?.propertyOptionId).toBe('launch');
  });

  it('resolves nothing for a tag outside the loaded sets', () => {
    expect(tagFacetOption<Item>('missing', context)).toBeUndefined();
    expect(tagFacetOption<Item>('urgent', EMPTY_TAG_FACET_CONTEXT)).toBe(
      undefined
    );
  });

  it('compiles the selection to one property filter per tag', () => {
    const ast = compileFacets(
      { tags: ['urgent', 'launch'] },
      [TAG_FACET],
      context
    );

    expect(ast.propf).toEqual({
      '|': [
        { l: { pd: 'team-definition', v: { so: 'launch' } } },
        { l: { pd: 'personal-definition', v: { so: 'urgent' } } },
      ],
    });
  });

  it('admits items carrying any selected tag', () => {
    const matches = (item: Item) =>
      testFacets({ tags: ['urgent'] }, [TAG_FACET], item, context);

    expect(matches(tagged('urgent'))).toBe(true);
    expect(matches(tagged('launch', 'urgent'))).toBe(true);
    expect(matches(tagged('launch'))).toBe(false);
    expect(matches({})).toBe(false);
  });
});

describe('tagFacetReady', () => {
  it('waits for the tag sets only while a tag is selected', () => {
    expect(tagFacetReady({}, false)).toBe(true);
    expect(tagFacetReady({ read: ['unread'] }, false)).toBe(true);
    expect(tagFacetReady({ tags: ['urgent'] }, false)).toBe(false);
    expect(tagFacetReady({ tags: ['urgent'] }, true)).toBe(true);
  });

  it('does not hold the query for a tag that no longer exists', () => {
    expect(tagFacetReady({ tags: ['gone'] }, true)).toBe(true);
  });
});

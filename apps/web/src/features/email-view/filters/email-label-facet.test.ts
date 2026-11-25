import { compileFacets } from '@app/features/soup/filters/facets/compile';
import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import type { EmailEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { EMAIL_FACETS } from './email-facets';
import { labelFacetOption } from './email-label-facet';

const LARKSPUR = '0199a1b2-0000-7000-8000-0000000000c1';
const ACME = '0199a1b2-0000-7000-8000-0000000000c2';

describe('the Labels facet', () => {
  it('asks the server for threads carrying any of the ticked labels', () => {
    expect(
      compileFacets(
        { labels: [LARKSPUR, ACME] },
        EMAIL_FACETS,
        EMPTY_TAG_FACET_CONTEXT
      ).ef
    ).toEqual({
      '|': [{ l: { Label: LARKSPUR } }, { l: { Label: ACME } }],
    });
  });

  it('keeps a loaded row only while it carries the label', () => {
    const matches = labelFacetOption(LARKSPUR).predicate;
    const row = (ids: string[]) =>
      ({ labels: ids.map((id) => ({ id })) }) as unknown as EmailEntity;

    expect(matches?.(row([ACME, LARKSPUR]), EMPTY_TAG_FACET_CONTEXT)).toBe(
      true
    );
    expect(matches?.(row([ACME]), EMPTY_TAG_FACET_CONTEXT)).toBe(false);
  });
});

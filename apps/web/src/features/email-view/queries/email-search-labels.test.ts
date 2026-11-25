import { EMPTY_TAG_FACET_CONTEXT } from '@app/features/soup/filters/facets/tag-facet';
import { describe, expect, it } from 'vitest';
import {
  buildEmailSearchRequest,
  type EmailSearchContext,
  facetsLeftToClient,
} from './email-search';

const LARKSPUR = '0199a1b2-0000-7000-8000-0000000000c1';
const ACME = '0199a1b2-0000-7000-8000-0000000000c2';
const GONE = '0199a1b2-0000-7000-8000-0000000000c3';

const emailFiltersFor = (overrides: Partial<EmailSearchContext>) => {
  const { body } = buildEmailSearchRequest(
    {
      scope: 'all',
      inboxIds: undefined,
      facets: {},
      facetContext: EMPTY_TAG_FACET_CONTEXT,
      ...overrides,
    },
    { query: 'invoice', matchType: 'partial' }
  );
  return body.filters?.email_filters;
};

describe('a search with labels ticked', () => {
  it('narrows by each known label’s stored name, as label: does', () => {
    const filters = emailFiltersFor({
      facets: { labels: [LARKSPUR, ACME, GONE] },
      labelNames: new Map([
        [LARKSPUR, 'Customers/Larkspur'],
        [ACME, 'Customers/Acme'],
      ]),
    });

    expect(filters?.include_labels).toEqual([
      'Customers/Larkspur',
      'Customers/Acme',
    ]);
  });

  it('sends no label it cannot name', () => {
    expect(
      emailFiltersFor({ facets: { labels: [GONE] } })?.include_labels
    ).toBeUndefined();
  });

  it('leaves labels to the service, since hits carry none to check', () => {
    expect(
      facetsLeftToClient(
        { labels: [LARKSPUR, GONE], focus: ['focus-follow-up'] },
        new Map([[LARKSPUR, 'Customers/Larkspur']])
      )
    ).toEqual({ focus: ['focus-follow-up'] });
  });

  it('keeps labels it can name none of on the client, so no hit matches', () => {
    expect(facetsLeftToClient({ labels: [GONE] }, new Map())).toEqual({
      labels: [GONE],
    });
  });
});

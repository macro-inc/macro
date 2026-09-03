import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({
    filters: {
      include: { documentId: ['baseline-document'] },
      exclude: { channelId: ['baseline-channel'] },
    },
    clientFilters: { and: ['search-supported'] },
  }),
}));

import {
  buildTaggedItemsSplitContent,
  type TagNavigationTarget,
} from './tagNavigation';

describe('buildTaggedItemsSplitContent', () => {
  it('seeds the split entry state so persisted search filters cannot override the tag', () => {
    const tag: TagNavigationTarget = {
      optionId: 'tag-option',
      propertyDefinitionId: 'tag-property',
    };

    expect(buildTaggedItemsSplitContent(tag)).toEqual({
      type: 'component',
      id: 'search',
      state: {
        'search.filters': {
          include: {
            documentId: ['baseline-document'],
            tagFilters: [
              {
                propertyId: 'tag-property',
                type: 'select',
                value: 'tag-option',
              },
            ],
            tagFilterMode: 'any',
          },
          exclude: { channelId: ['baseline-channel'] },
        },
        'search.predicates': { and: ['search-supported'] },
      },
    });
  });
});

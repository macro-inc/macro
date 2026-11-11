import type { DocumentEntity, EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { createSearchResultFilter } from './search-results';

const document: DocumentEntity = {
  type: 'document',
  id: 'guide',
  name: 'Guide',
  ownerId: 'owner',
  fileType: 'md',
};

describe('Search result scope', () => {
  it('excludes tasks and disabled snippets even if the full-text service returns them', () => {
    const matches = createSearchResultFilter('document-or-file', {
      exclude: { subType: ['task', 'snippet'] },
    });
    expect(matches(document)).toBe(true);
    expect(matches({ ...document, subType: { type: 'task' } })).toBe(false);
    expect(matches({ ...document, subType: { type: 'snippet' } })).toBe(false);
  });

  it('allows enabled snippets without including tasks or another index', () => {
    const matches = createSearchResultFilter('document-or-file', {
      exclude: { subType: ['task'] },
    });
    expect(matches({ ...document, subType: { type: 'snippet' } })).toBe(true);
    expect(matches({ ...document, type: 'chat' })).toBe(false);
  });

  it('keeps unsupported CRM rows out of mixed cached or full-text results', () => {
    const company: EntityData = {
      type: 'crm_company',
      id: 'company',
      name: 'Guide',
      ownerId: 'owner',
      teamId: 'team',
      hidden: false,
      domains: [],
    };
    const matches = createSearchResultFilter('all', {});
    expect(matches(company)).toBe(false);
    expect(matches(document)).toBe(true);
  });
});

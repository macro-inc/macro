import { NIL_UUID, type TagFacetContext } from '@app/features/soup/filters';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { buildDriveSearchRequest } from './drive-search';

const facetContext: TagFacetContext = {
  tagPropertyDefinitionByOptionId: new Map([['urgent', 'tag-definition']]),
};

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'updated_at',
  search: 'quarterly plan',
  facets: {},
};

function requestFilters(
  selected: DriveSelection = selection,
  userId: string | undefined = 'me'
) {
  const request = buildDriveSearchRequest({
    selection: selected,
    userId,
    facetContext,
    query: selected.search,
    matchType: 'partial',
  });
  if (!request.body.filters) throw new Error('search request has no filters');
  return request.body.filters;
}

describe('buildDriveSearchRequest', () => {
  it('builds the standard soup search request shape', () => {
    expect(
      buildDriveSearchRequest({
        selection,
        userId: 'me',
        facetContext,
        query: 'quarterly plan',
        matchType: 'exact',
      })
    ).toMatchObject({
      params: { cursor: null, page_size: 100 },
      body: {
        query: 'quarterly plan',
        match_type: 'exact',
        search_on: 'name_content',
      },
    });
  });

  it('allows only documents outside folders', () => {
    expect(requestFilters()).toEqual({
      agent_session_filters: { ids: [NIL_UUID] },
      calendar_event_filters: { calendar_event_ids: [NIL_UUID] },
      call_filters: { call_ids: [NIL_UUID] },
      channel_filters: { channel_ids: [NIL_UUID] },
      channel_thread_filters: { thread_ids: [NIL_UUID] },
      chat_filters: { chat_ids: [NIL_UUID] },
      crm_company_filters: { company_ids: [NIL_UUID] },
      document_filters: {
        is_email_attachment: false,
        owners: ['me'],
      },
      email_filters: { email_thread_ids: [NIL_UUID] },
      foreign_entity_filters: { ids: [NIL_UUID] },
      project_filters: { project_ids: [NIL_UUID] },
      reminder_filters: { ids: [NIL_UUID] },
    });
  });

  it('allows only projects at the Drive root', () => {
    const filters = requestFilters({
      ...selection,
      location: { kind: 'folder', id: null },
    });

    expect(filters.project_filters).toEqual({});
    expect(filters.document_filters).toEqual({ document_ids: [NIL_UUID] });
    expect(filters.chat_filters).toEqual({ chat_ids: [NIL_UUID] });
    expect(filters.email_filters).toEqual({ email_thread_ids: [NIL_UUID] });
  });

  it('scopes documents, chats, projects, and emails to a selected folder', () => {
    const filters = requestFilters({
      ...selection,
      location: { kind: 'folder', id: 'folder-1' },
      facets: { 'created-by': ['creator-1'] },
    });

    expect(filters.document_filters).toEqual({
      is_email_attachment: false,
      owners: ['creator-1'],
      project_ids: ['folder-1'],
    });
    expect(filters.chat_filters).toEqual({
      owners: ['creator-1'],
      project_ids: ['folder-1'],
    });
    expect(filters.project_filters).toEqual({
      owners: ['creator-1'],
      project_ids: ['folder-1'],
    });
    expect(filters.email_filters).toEqual({ project_ids: ['folder-1'] });
    expect(filters.channel_filters).toEqual({ channel_ids: [NIL_UUID] });
  });

  it('preserves false, true, and unset attachment scopes', () => {
    expect(requestFilters().document_filters?.is_email_attachment).toBe(false);
    expect(
      requestFilters({ ...selection, scope: 'attachments' }).document_filters
        ?.is_email_attachment
    ).toBe(true);
    expect(
      requestFilters({ ...selection, scope: 'all' }).document_filters
        ?.is_email_attachment
    ).toBeUndefined();
  });

  it('keeps owned/default creator intersections and leaves Shared negative client-side', () => {
    const ownedMismatch = requestFilters({
      ...selection,
      facets: { 'created-by': ['creator-1'] },
    });
    expect(ownedMismatch.document_filters?.owners).toEqual([NIL_UUID]);

    const shared = requestFilters({
      ...selection,
      location: { kind: 'tab', tab: 'shared' },
      facets: { 'created-by': ['creator-1', 'me'] },
    });
    expect(shared.document_filters?.owners).toEqual(['creator-1']);
    const selfOnly = requestFilters({
      ...selection,
      location: { kind: 'tab', tab: 'shared' },
      facets: { 'created-by': ['me'] },
    });
    expect(selfOnly.document_filters?.owners).toEqual([NIL_UUID]);
  });

  it('maps only resolved tag options at the filter root', () => {
    const filters = requestFilters({
      ...selection,
      facets: { tags: ['urgent', 'deleted-tag'] },
    });

    expect(filters.tag_option_ids).toEqual(['urgent']);
    expect(filters.tag_filter_mode).toBe('any');
  });

  it('narrows finite type unions before service pagination', () => {
    const filters = requestFilters({
      ...selection,
      scope: 'all',
      facets: { type: ['doc-markdown', 'file-pdf'] },
    });
    expect(filters.document_filters?.file_types).toEqual(['md', 'pdf']);
    const openEnded = requestFilters({
      ...selection,
      scope: 'all',
      facets: { type: ['file-pdf', 'file-other'] },
    });
    expect(openEnded.document_filters?.file_types).toBeUndefined();
  });
});

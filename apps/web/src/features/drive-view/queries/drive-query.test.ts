import { NIL_UUID, type TagFacetContext } from '@app/features/soup/filters';
import { describe, expect, it } from 'vitest';
import type { DriveSelection } from '../context/drive-source';
import { buildDriveQuery } from './drive-query';

const facetContext: TagFacetContext = {
  tagPropertyDefinitionByOptionId: new Map([['urgent', 'tag-definition']]),
};

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'updated_at',
  search: '',
  facets: {},
};

function request(
  selected: DriveSelection = selection,
  userId: string | undefined = 'me'
) {
  return buildDriveQuery({
    selection: selected,
    userId,
    facetContext,
    snippetsEnabled: true,
  });
}

describe('buildDriveQuery', () => {
  it('builds the owned/default document scope and request params', () => {
    const result = request();

    expect(result.params).toEqual({
      expand: true,
      limit: 100,
      sort_method: 'updated_at',
      sort_direction: 'desc',
    });
    expect(result.body.df).toEqual({
      '&': [
        {
          '&': [{ '!': { l: { dst: 'task' } } }, { l: { iea: false } }],
        },
        { l: { o: 'me' } },
      ],
    });
    expect(result.body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
    expect(result.body.cf).toEqual({ l: { cid: NIL_UUID } });
    expect(result.body.pf).toEqual({ l: { pid: NIL_UUID } });
  });

  it('excludes disabled snippets before paginating the list', () => {
    const result = buildDriveQuery({ selection, userId: 'me', facetContext });
    expect(JSON.stringify(result.body.df)).toContain(
      '"!":{"l":{"dst":"snippet"}}'
    );
    expect(JSON.stringify(request().body.df)).not.toContain('snippet');
  });

  it('drops owned scoping outside default and maps attachment scope', () => {
    const all = request({ ...selection, scope: 'all' });
    expect(all.body.df).toEqual({ '!': { l: { dst: 'task' } } });

    const attachments = request({ ...selection, scope: 'attachments' });
    expect(attachments.body.df).toEqual({
      '&': [{ '!': { l: { dst: 'task' } } }, { l: { iea: true } }],
    });
  });

  it('keeps shared exclusion when a creator facet is selected', () => {
    const shared = request({
      ...selection,
      location: { kind: 'tab', tab: 'shared' },
      facets: { 'created-by': ['creator-1'] },
    });

    expect(shared.body.df).toEqual({
      '&': [
        {
          '&': [
            {
              '&': [{ '!': { l: { dst: 'task' } } }, { l: { iea: false } }],
            },
            { '!': { l: { o: 'me' } } },
          ],
        },
        { l: { o: 'creator-1' } },
      ],
    });
  });

  it('matches nothing for an owner-dependent tab without a user', () => {
    const owned = buildDriveQuery({
      selection,
      userId: undefined,
      facetContext,
    });
    expect(owned.body.df).toEqual({ l: { id: NIL_UUID } });

    const shared = buildDriveQuery({
      selection: {
        ...selection,
        location: { kind: 'tab', tab: 'shared' },
      },
      userId: undefined,
      facetContext,
    });
    expect(shared.body.df).toEqual({ l: { id: NIL_UUID } });
  });

  it('allows only projects at the Drive root', () => {
    const root = request({
      ...selection,
      location: { kind: 'folder', id: null },
    });

    expect(root.body.pf).toBeUndefined();
    expect(root.body.df).toEqual({ l: { id: NIL_UUID } });
    expect(root.body.cf).toEqual({ l: { cid: NIL_UUID } });
    expect(root.body.ef).toEqual({ l: { ThreadId: NIL_UUID } });
  });

  it('scopes every supported folder entity type to its parent', () => {
    const folder = request({
      ...selection,
      location: { kind: 'folder', id: 'folder-1' },
    });

    expect(folder.body.df).toEqual({
      '&': [{ l: { pid: 'folder-1' } }, { l: { iea: false } }],
    });
    expect(folder.body.cf).toEqual({ l: { pid: 'folder-1' } });
    expect(folder.body.pf).toEqual({ l: { pid: 'folder-1' } });
    expect(folder.body.ef).toEqual({ l: { ProjectId: 'folder-1' } });
    expect(folder.body.emailView).toBe('all');
    expect(folder.body.chanf).toEqual({ l: { ChannelId: NIL_UUID } });
  });

  it('combines type and tag facets with the base scope', () => {
    const filtered = request({
      ...selection,
      facets: { type: ['file-pdf'], tags: ['urgent'] },
    });

    expect(JSON.stringify(filtered.body.df)).toContain('"ft":"pdf"');
    expect(filtered.body.propf).toEqual({
      l: { pd: 'tag-definition', v: { so: 'urgent' } },
    });
  });

  it('uses touched_by_me for Recent without unsupported email/channel trees', () => {
    const recent = request({
      ...selection,
      location: { kind: 'tab', tab: 'recent' },
      facets: { type: ['file-pdf'] },
    });

    expect(recent.params.sort_method).toBe('touched_by_me');
    expect(recent.body.ef).toBeUndefined();
    expect(recent.body.chanf).toBeUndefined();
    expect(JSON.stringify(recent.body.df)).toContain('"ft":"pdf"');
  });
});

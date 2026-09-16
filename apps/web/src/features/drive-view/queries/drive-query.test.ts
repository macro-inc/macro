import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/constant/featureFlags', () => ({
  enableCalendarUi: {},
  enableReminders: {},
  enableSnippets: {},
  enableSupportedSoupForeignEntities: {},
  isCalendarSearchUiEnabled: () => false,
  isFeatureEnabled: () => false,
}));

import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import type { DriveSelection } from '../context/drive-source';
import { driveFilterTab, driveQuery } from './drive-query';

const selection: DriveSelection = {
  location: { kind: 'tab', tab: 'owned' },
  scope: 'default',
  sort: 'updated_at',
};

describe('Drive query scopes', () => {
  it('keeps owned/shared scopes and excludes tasks and disabled snippets', () => {
    const owned = driveQuery(selection, 'me');
    expect(driveFilterTab(selection)).toBe('owned');
    expect(owned.filters.include?.documentOwnerId).toEqual(['me']);
    expect(owned.filters.exclude?.subType).toEqual(['task', 'snippet']);
    const shared = driveQuery(
      { ...selection, location: { kind: 'tab', tab: 'shared' } },
      'me'
    );
    expect(shared.filters.exclude?.documentOwnerId).toEqual(['me']);
    expect(shared.clientFilters.and).toContain('shared-entity');
  });
  it('allows all files and attachments without retaining the owned restriction', () => {
    expect(driveFilterTab({ ...selection, scope: 'all' })).toBe('all');
    expect(driveFilterTab({ ...selection, scope: 'attachments' })).toBe(
      'attachments'
    );
    const all = driveQuery({ ...selection, scope: 'all' }, 'me');
    expect(all.filters.include?.documentOwnerId).toBeUndefined();
    const attachments = driveQuery(
      { ...selection, scope: 'attachments' },
      'me'
    );
    expect(attachments.filters.include?.isEmailAttachment).toBe(true);
    expect(attachments.filters.include?.documentOwnerId).toBeUndefined();
  });
  it('scopes every supported folder entity type to the selected folder', () => {
    const folder = driveQuery(
      { ...selection, location: { kind: 'folder', id: 'folder' } },
      'me'
    );
    expect(folder.filters.include).toMatchObject({
      projectId: ['folder'],
      chatProjectId: ['folder'],
      folderId: ['folder'],
      emailProjectId: ['folder'],
    });
    expect(folder.filters.emailView).toBe('all');
    expect(folder.clientFilters).toEqual({});
  });
  it('keeps Recent compatible with the touched feed and restricts display to files', () => {
    const recent = driveQuery(
      { ...selection, location: { kind: 'tab', tab: 'recent' } },
      'me'
    );
    const ast = compileToAst(queryStateFrom(recent.filters));
    expect(ast.chanf).toBeUndefined();
    expect(ast.ef).toBeUndefined();
    expect(recent.clientFilters.and).toEqual(['document-or-file']);
    expect(recent.filters.exclude?.subType).toContain('task');
  });
});

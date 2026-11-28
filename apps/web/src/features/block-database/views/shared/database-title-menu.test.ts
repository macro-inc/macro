import { describe, expect, it } from 'vitest';
import { databaseTitleMenuRows } from './database-title-menu';

describe('databaseTitleMenuRows', () => {
  it('offers an editor every Database actions item', () => {
    expect(databaseTitleMenuRows({ canEdit: true, hasTable: true })).toEqual([
      'rename',
      'duplicate',
      'move-to-folder',
      'import-csv',
      'webhooks',
      'sync',
      'download-csv',
      'delete',
    ]);
  });

  it('leaves a viewer without the rows that edit the database', () => {
    expect(databaseTitleMenuRows({ canEdit: false, hasTable: true })).toEqual([
      'duplicate',
      'move-to-folder',
      'download-csv',
      'delete',
    ]);
  });

  it('drops the per-table rows of a database without tables', () => {
    expect(databaseTitleMenuRows({ canEdit: true, hasTable: false })).toEqual([
      'rename',
      'duplicate',
      'move-to-folder',
      'import-csv',
      'sync',
      'delete',
    ]);
  });
});

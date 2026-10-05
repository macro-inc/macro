import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFormDetailSource } from './form-sources';

const sync = vi.hoisted(() => ({
  databaseFollowed: [] as (string | undefined)[],
  responsesFollowed: [] as (string | undefined)[],
  access: 'view',
}));
vi.mock('@queries/storage/forms', () => ({
  useFormDetailQuery: () => ({
    isSuccess: true,
    data: {
      form: {
        id: 'form-1',
        name: 'Lunch?',
        description: '',
        ownerId: 'macro|owner@example.com',
        databaseId: 'database-1',
        tableId: 'table-1',
        audience: 'members',
        status: 'open',
        closesAt: null,
        tallyVisible: true,
        confirmationMessage: '',
        submittedColumnId: null,
        respondentColumnId: null,
      },
      sections: [],
      access: sync.access,
      tableGone: false,
    },
  }),
}));
vi.mock('@queries/storage/forms-sync', () => ({
  useFormChangedSync: () => {},
  useFormDatabaseSync: (
    databaseId: () => string | undefined,
    isEditor: () => boolean
  ) => {
    sync.databaseFollowed.push(isEditor() ? databaseId() : undefined);
  },
  useFormResponsesSync: (
    _formId: () => string,
    databaseId: () => string | undefined
  ) => {
    sync.responsesFollowed.push(databaseId());
  },
}));

beforeEach(() => {
  sync.databaseFollowed = [];
  sync.responsesFollowed = [];
});

describe('createFormDetailSource', () => {
  it('follows the form’s database once, for editors only; respondents never track it', () => {
    sync.access = 'view';
    createRoot((dispose) => {
      createFormDetailSource(() => 'form-1');
      dispose();
    });
    expect(sync.databaseFollowed).toEqual([undefined]);
    sync.access = 'edit';
    createRoot((dispose) => {
      createFormDetailSource(() => 'form-1');
      dispose();
    });
    expect(sync.databaseFollowed).toEqual([undefined, 'database-1']);
    expect(sync.responsesFollowed).toEqual(['database-1', 'database-1']);
  });
});

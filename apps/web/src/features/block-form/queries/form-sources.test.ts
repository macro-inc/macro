import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFormDetailSource } from './form-sources';

const sync = vi.hoisted(() => ({
  databaseFollowed: [] as (string | undefined)[],
  responsesFollowed: [] as (string | undefined)[],
  databasesRead: [] as (string | undefined)[],
  access: 'view',
  formReads: 0,
  databaseName: (): string => 'Offsite',
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
    refetch: async () => {
      sync.formReads += 1;
      return { isError: false };
    },
  }),
}));
vi.mock('@queries/storage/databases', () => ({
  useDatabaseDetailQuery: (databaseId: () => string | undefined) => {
    sync.databasesRead.push(databaseId());
    return {
      get isSuccess() {
        return databaseId() !== undefined;
      },
      get data() {
        return { database: { name: sync.databaseName() } };
      },
    };
  },
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
  sync.databasesRead = [];
  sync.formReads = 0;
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

  it('reads the form again when an editor’s database is renamed, so a form named after it follows', () => {
    sync.access = 'edit';
    const [name, rename] = createSignal('Offsite');
    sync.databaseName = name;
    const dispose = createRoot((dispose) => {
      createFormDetailSource(() => 'form-1');
      return dispose;
    });
    expect(sync.databasesRead).toEqual(['database-1']);
    rename('Offsite');
    expect(sync.formReads).toBe(0);
    rename('Offsite 2027');
    expect(sync.formReads).toBe(1);
    dispose();
    sync.access = 'view';
    createRoot((dispose) => {
      createFormDetailSource(() => 'form-1');
      dispose();
    });
    expect(sync.databasesRead).toEqual(['database-1', undefined]);
  });
});

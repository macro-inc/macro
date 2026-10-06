import { ThrownResultError } from '@core/util/result';
import type { FormsError } from '@service-storage/forms';
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
  queryError: (): unknown => undefined,
}));
vi.mock('@queries/storage/forms', () => ({
  useFormDetailQuery: () => ({
    get isSuccess() {
      return sync.queryError() === undefined;
    },
    get isError() {
      return sync.queryError() !== undefined;
    },
    isPending: false,
    get error() {
      return sync.queryError();
    },
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
  sync.queryError = () => undefined;
});

describe('createFormDetailSource', () => {
  it('keeps cached detail through a temporary refresh failure and recovery', () => {
    const [failure, setFailure] = createSignal<unknown>();
    sync.queryError = failure;
    sync.access = 'owner';
    createRoot((dispose) => {
      const source = createFormDetailSource(() => 'form-1');
      expect(source.detail()?.form.name).toBe('Lunch?');
      setFailure(new Error('Connection lost'));
      expect(source.detail()?.form.name).toBe('Lunch?');
      expect(source.failure()?.kind).toBe('failed');
      setFailure(undefined);
      expect(source.detail()?.form.name).toBe('Lunch?');
      expect(source.failure()).toBeUndefined();
      dispose();
    });
  });

  it.each(['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND'] as const)(
    'removes cached detail when a refresh revokes access with %s',
    (code) => {
      const [failure, setFailure] = createSignal<unknown>();
      sync.queryError = failure;
      sync.access = 'owner';
      createRoot((dispose) => {
        const source = createFormDetailSource(() => 'form-1');
        expect(source.detail()).toBeDefined();
        const error: FormsError = {
          code,
          message: 'Access denied',
          refusal: null,
        };
        setFailure(new ThrownResultError([error]));
        expect(source.detail()).toBeUndefined();
        dispose();
      });
    }
  );
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

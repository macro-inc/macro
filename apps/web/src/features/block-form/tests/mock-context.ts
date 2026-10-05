import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  FormColumnWrites,
  FormContext,
  FormDetailSource,
} from '../context/form-context';
import type { FormColumn, FormDetail, FormLayout } from '../core/form-model';

/** What a mocked context was asked to do, in order. */
export type MockFormCalls = {
  layouts: FormLayout[];
  notices: string[];
};

/**
 * In-memory capabilities for views. The form detail is a signal the test
 * can replace; layout saves echo back.
 */
export function createMockFormContext(options: {
  detail: FormDetail;
  tableColumns?: FormColumn[];
  overrides?: Partial<FormContext>;
}) {
  const [detail, setDetail] = createSignal<FormDetail | undefined>(
    options.detail
  );
  const calls: MockFormCalls = {
    layouts: [],
    notices: [],
  };
  const source: FormDetailSource = {
    detail,
    failure: () => undefined,
    refetch: async () => true,
  };
  const writes: FormColumnWrites = {
    create: () => okAsync(undefined),
    rename: () => okAsync(undefined),
    changeType: () => okAsync(undefined),
    addOptions: () => okAsync(undefined),
    updateOption: () => okAsync(undefined),
    deleteOption: () => okAsync(undefined),
    remove: () => okAsync(undefined),
    convert: () => okAsync('converted'),
  };
  const context: FormContext = {
    createFormSource: () => source,
    createTableSource: () => ({
      columns: () => options.tableColumns ?? options.detail.columns,
      databaseName: () => 'Offsite',
      tableName: () => 'Responses',
      tables: () => [{ id: options.detail.form.tableId, name: 'Responses' }],
      refetch: async () => {},
    }),
    followTable: () => {},
    saveLayout: (_, layout) => {
      calls.layouts.push(layout);
      const current = detail();
      if (!current) return errAsync({ message: 'gone' });
      const saved = { ...current, layout };
      setDetail(saved);
      return okAsync(saved);
    },
    updateMetadata: () => okAsync(undefined),
    renameForm: () => okAsync(undefined),
    trashForm: () => okAsync(undefined),
    confirm: async () => true,
    columns: () => writes,
    responses: {
      createSummary: () => ({
        value: () => ({
          submitted: 0,
          stopped: 0,
          stoppedBySection: [],
          rows: 0,
        }),
        failure: () => undefined,
      }),
    },
    notify: {
      success: (message) => calls.notices.push(`✓ ${message}`),
      failure: (message) => calls.notices.push(`✗ ${message}`),
    },
    ui: {
      renderConditionEditor: () => null,
    },
    ...options.overrides,
  };
  return { context, calls, setDetail, source };
}

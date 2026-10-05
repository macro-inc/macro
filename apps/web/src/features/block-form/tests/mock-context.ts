import { errAsync, okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  FormColumnWrites,
  FormContext,
  FormDetailSource,
  MyResponse,
  SubmitOutcome,
} from '../context/form-context';
import type { SubmittedAnswer } from '../core/answers';
import type { FormColumn, FormDetail, FormLayout } from '../core/form-model';

export const MOCK_VIEWER_ID = 'macro|respondent@example.com';

/** What a mocked context was asked to do, in order. */
export type MockFormCalls = {
  submitted: SubmittedAnswer[][];
  edited: SubmittedAnswer[][];
  layouts: FormLayout[];
  notices: string[];
  messagedOwners: string[];
};

/**
 * In-memory capabilities for views. The form detail is a signal the test
 * can replace; submissions answer `submitOutcome`; layout saves echo back.
 * Pickers and the grid render labelled placeholders.
 */
export function createMockFormContext(options: {
  detail: FormDetail;
  tableColumns?: FormColumn[];
  viewerId?: string | undefined;
  mine?: MyResponse | null;
  submitOutcome?: SubmitOutcome;
  overrides?: Partial<FormContext>;
}) {
  const [detail, setDetail] = createSignal<FormDetail | undefined>(
    options.detail
  );
  const calls: MockFormCalls = {
    submitted: [],
    edited: [],
    layouts: [],
    notices: [],
    messagedOwners: [],
  };
  const outcome: SubmitOutcome = options.submitOutcome ?? {
    kind: 'submitted',
    responseId: 'response-1',
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
    viewer: {
      userId: () => ('viewerId' in options ? options.viewerId : MOCK_VIEWER_ID),
    },
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
      submit: (_, answers) => {
        calls.submitted.push(answers);
        return okAsync(outcome);
      },
      editMine: (_, answers) => {
        calls.edited.push(answers);
        return okAsync(outcome);
      },
      createMine: () => ({
        response: () => options.mine ?? null,
        failure: () => undefined,
        refetch: async () => {},
      }),
      createSummary: () => ({
        value: () => ({
          submitted: 0,
          stopped: 0,
          stoppedBySection: [],
          rows: 0,
        }),
        failure: () => undefined,
      }),
      createTally: () => ({ value: () => [], failure: () => undefined }),
      createInvited: () => ({ value: () => null, failure: () => undefined }),
      exportCsv: () => okAsync(undefined),
    },
    uploadFile: () => okAsync('https://static.example.com/file/1'),
    messageOwner: (ownerId) => {
      calls.messagedOwners.push(ownerId);
      return okAsync(undefined);
    },
    notify: {
      success: (message) => calls.notices.push(`✓ ${message}`),
      failure: (message) => calls.notices.push(`✗ ${message}`),
    },
    ui: {
      renderEntityPicker: () => null,
      renderRelationPicker: () => null,
      renderConditionEditor: () => null,
      renderResponsesGrid: () => null,
      renderEntityLabel: (entity) => entity.entityId,
    },
    ...options.overrides,
  };
  return { context, calls, setDetail, source };
}

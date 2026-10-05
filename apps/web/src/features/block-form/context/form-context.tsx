import type { ResultAsync } from 'neverthrow';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type {
  FormAudience,
  FormColumn,
  FormColumnKind,
  FormDetail,
  FormLayout,
  FormStatus,
  GateRules,
} from '../core/form-model';
import type { ResponseCounts } from '../core/response-stats';

/** Why a form could not be read. */
export type FormLoadFailure =
  | { kind: 'not-found' }
  | { kind: 'sign-in' }
  | { kind: 'forbidden' }
  | { kind: 'failed'; message: string };

/** Why the forms service refused a request, in the feature's own words. */
export type FormRefusal =
  | 'not-found'
  | 'forbidden'
  | 'owner-only'
  | 'sign-in-required'
  | 'closed'
  | 'table-gone'
  | 'already-responded'
  | 'no-response'
  | 'unknown-question'
  | 'repeated-answer'
  | 'missing-answer'
  | 'invalid-answer'
  | 'widget-mismatch'
  | 'file-upload-needs-sign-in'
  | 'invalid-layout'
  | 'invalid-name'
  | 'invalid-sharing'
  | 'tally-hidden'
  | 'conflict'
  | 'internal';

/** A refused or failed write, in words the UI can show. */
export type FormWriteFailure = {
  message: string;
  /** The forms service's refusal, when it explained itself. */
  refusal?: FormRefusal;
  /** The question a refused answer or layout names. */
  questionId?: string;
};

/** One form's detail as the server last answered it. */
export type FormDetailSource = {
  /** Undefined until loaded. */
  detail: Accessor<FormDetail | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
  /** Read again; resolves whether the read succeeded (a failed read resolves too). */
  refetch: () => Promise<boolean>;
};

/** The linked table's schema, for editors, who can read the database. */
export type FormTableSource = {
  /** Every column of the table, in table order; undefined until loaded. */
  columns: Accessor<FormColumn[] | undefined>;
  databaseName: Accessor<string | undefined>;
  tableName: Accessor<string | undefined>;
  /** The database's tables, for a relation question's table picker. */
  tables: Accessor<{ id: string; name: string }[]>;
  /** Read the table again; resolves once it answered. */
  refetch: () => Promise<void>;
};

export type OptionChange = { label?: string; color?: string | null };

/** Column facts, written through the database's own ops (RFC 02 §3). */
export type FormColumnWrites = {
  create: (column: {
    id: string;
    name: string;
    kind: FormColumnKind;
    options: { id: string; label: string }[];
  }) => ResultAsync<void, FormWriteFailure>;
  rename: (
    columnId: string,
    name: string,
    previousName: string
  ) => ResultAsync<void, FormWriteFailure>;
  changeType: (
    columnId: string,
    to: FormColumnKind
  ) => ResultAsync<void, FormWriteFailure>;
  addOptions: (
    columnId: string,
    options: { id: string; label: string }[]
  ) => ResultAsync<void, FormWriteFailure>;
  updateOption: (
    columnId: string,
    optionId: string,
    change: OptionChange
  ) => ResultAsync<void, FormWriteFailure>;
  deleteOption: (
    columnId: string,
    optionId: string
  ) => ResultAsync<void, FormWriteFailure>;
  remove: (columnId: string) => ResultAsync<void, FormWriteFailure>;
  /** A new column beside `columnId` holding its values that convert; answers its id. */
  convert: (
    columnId: string,
    to: FormColumnKind,
    name: string
  ) => ResultAsync<string, FormWriteFailure>;
};

export type FormMetadataPatch = {
  description?: string;
  confirmationMessage?: string;
  audience?: FormAudience;
  status?: FormStatus;
  closesAt?: string | null;
  tallyVisible?: boolean;
};

export type ReadSource<Value> = {
  value: Accessor<Value | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
};

export type ConditionEditorProps = {
  /** The columns the rules may test, in form order. */
  columns: FormColumn[];
  rules: GateRules | null;
  onChange: (rules: GateRules | null) => void;
};

/**
 * What Macro Forms needs from the app. Production wiring lives in
 * `../form-context-production.tsx`; tests supply their own.
 */
export type FormContext = {
  createFormSource: (formId: Accessor<string>) => FormDetailSource;
  createTableSource: (
    databaseId: Accessor<string | undefined>,
    tableId: Accessor<string | undefined>
  ) => FormTableSource;
  /** Re-read the form whenever its database's table changes (editors hear them). */
  followTable: (
    databaseId: Accessor<string | undefined>,
    onChange: () => void
  ) => void;
  saveLayout: (
    formId: string,
    layout: FormLayout
  ) => ResultAsync<FormDetail, FormWriteFailure>;
  updateMetadata: (
    formId: string,
    patch: FormMetadataPatch
  ) => ResultAsync<void, FormWriteFailure>;
  /** Rename through the unified entity mutation router; the database keeps its name. */
  renameForm: (
    formId: string,
    name: string
  ) => ResultAsync<void, FormWriteFailure>;
  /** Move the form to the trash; its database and response rows stay. */
  trashForm: (formId: string) => ResultAsync<void, FormWriteFailure>;
  /** Ask before something destructive; resolves with the choice. */
  confirm: (question: {
    title: string;
    body: string;
    confirmLabel: string;
    tone: 'default' | 'danger';
  }) => Promise<boolean>;
  columns: (databaseId: string, tableId: string) => FormColumnWrites;
  responses: {
    createSummary: (
      formId: Accessor<string>,
      enabled: Accessor<boolean>
    ) => ReadSource<ResponseCounts>;
  };
  notify: {
    success: (message: string) => void;
    failure: (message: string) => void;
  };
  ui: {
    renderConditionEditor: (props: ConditionEditorProps) => JSX.Element;
  };
};

const Context = createContext<FormContext>();

export const FormProvider = Context.Provider;

export function useFormContext(): FormContext {
  const context = useContext(Context);
  if (!context) throw new Error('FormProvider is required');
  return context;
}

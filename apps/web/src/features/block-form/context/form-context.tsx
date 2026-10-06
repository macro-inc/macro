import type {
  BookingReceipt,
  PublicEvent,
  PublicProfile,
} from '@app/features/scheduling/core/types';
import type { BookingSource } from '@app/features/scheduling/primitives/booking-flow';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type { SubmittedAnswer } from '../core/answers';
import type {
  FormAudience,
  FormBookingTarget,
  FormCellValue,
  FormColumn,
  FormColumnKind,
  FormDetail,
  FormEntityKind,
  FormEntityReference,
  FormLayout,
  FormStatus,
  GateRules,
  UnlockedBooking,
} from '../core/form-model';
import type { FormSelection } from '../core/form-presence';
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
  | 'table-already-has-form'
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

/** Whether the shared layout is open for editing. */
export type FormLayoutStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/**
 * Whether the server holds every local layout edit. `unsaved` edits wait on
 * this device and go once the server takes them; `unstored` ones could not
 * be stored on it and live only in this tab until they go.
 */
export type FormLayoutSave = 'saved' | 'saving' | 'unsaved' | 'unstored';

export type FormLayoutConnection = 'connected' | 'connecting' | 'offline';

/** Another editor of the form and what they selected. */
export type FormEditorPeer = {
  peerId: string;
  userId: string | undefined;
  /** A palette color name, the one their cursor has everywhere. */
  color: string;
  selection: FormSelection;
};

/**
 * The layout every editor of one form edits at once. Each edit is written
 * as the change from `previous` to `next`, so concurrent edits to other
 * sections and questions survive. The form's facts and the table's columns
 * are not in it.
 */
export type FormLayoutCollaboration = {
  status: Accessor<FormLayoutStatus>;
  /** The shared layout; undefined until it opened. */
  layout: Accessor<FormLayout | undefined>;
  save: Accessor<FormLayoutSave>;
  connection: Accessor<FormLayoutConnection>;
  /** Write the edits from `previous` to `next`. Throws unless open. */
  apply: (previous: FormLayout, next: FormLayout) => void;
  /** Resolves once the server holds every local edit and published them. */
  flush: () => ResultAsync<void, FormWriteFailure>;
  /** Why respondents still see the last valid layout, until it is fixed. */
  publicationError: Accessor<string | undefined>;
  peers: Accessor<FormEditorPeer[]>;
  /** Show the other editors what this one selected; `undefined` clears it. */
  select: (selection: FormSelection | undefined) => void;
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

export type SubmitOutcome =
  | {
      kind: 'submitted';
      responseId: string;
      /** The booking step this response unlocked, if the form has one. */
      booking: UnlockedBooking | null;
    }
  | { kind: 'stopped'; sectionId: string; message: string };

/** The viewer's own response: `null` before they respond. */
export type MyResponse = {
  status: 'submitted' | 'stopped';
  submittedAt: string;
  answers: SubmittedAnswer[];
  /** The booking step, while the saved answers still pass the form's screeners. */
  booking: UnlockedBooking | null;
};

export type MyResponseSource = {
  response: Accessor<MyResponse | null | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
  refetch: () => Promise<void>;
};

export type QuestionTally = {
  questionId: string;
  responses: number;
  buckets: (
    | { kind: 'option'; optionId: string; count: number }
    | { kind: 'checkbox'; checked: boolean; count: number }
  )[];
};

export type ReadSource<Value> = {
  value: Accessor<Value | undefined>;
  failure: Accessor<FormLoadFailure | undefined>;
};

/** A picker the app owns, filling one answer. */
export type EntityPickerProps = {
  target: FormEntityKind;
  multi: boolean;
  value: FormCellValue | undefined;
  onChange: (value: FormCellValue) => void;
  label: string;
  invalid: boolean;
};

export type RelationPickerProps = {
  databaseId: string;
  tableId: string;
  value: FormCellValue | undefined;
  onChange: (value: FormCellValue) => void;
  label: string;
  invalid: boolean;
};

export type ConditionEditorProps = {
  /** The columns the rules may test, in form order. */
  columns: FormColumn[];
  rules: GateRules | null;
  onChange: (rules: GateRules | null) => void;
};

/** A native booking event, as anyone with its link reads it. */
export type FormBookingEvent = { profile: PublicProfile; event: PublicEvent };

/** One of the editor's own booking links, offered for a booking step. */
export type FormBookingLink = {
  target: FormBookingTarget;
  title: string;
  durationMinutes: number;
  /** Whose link it is: "Personal" or a team's name. */
  owner: string;
};

/** Native Macro scheduling, as forms use it for a booking step. */
export type FormBooking = {
  /** Whether the viewer can create and pick booking links. */
  available: Accessor<boolean>;
  /** The editor's own booking links; `[]` when they have none. */
  createLinks: (enabled: Accessor<boolean>) => ReadSource<FormBookingLink[]>;
  /** The event a target books; `null` once it is turned off or deleted. */
  createEvent: (
    target: Accessor<FormBookingTarget | undefined>
  ) => ReadSource<FormBookingEvent | null>;
  /** Availability and booking, the public booking page's own. */
  createSource: () => BookingSource;
  /** Show the native receipt for a booking just made. */
  openReceipt: (receipt: BookingReceipt) => void;
  /** Where booking links are created: Calendar settings. */
  openSettings: () => void;
};

export type EditorsProps = {
  peers: FormEditorPeer[];
  /** What they selected, for the accessible name: “this question”. */
  selected: string;
};

export type ResponsesGridProps = {
  databaseId: string;
  tableId: string;
};

/**
 * What Macro Forms needs from the app. Production wiring lives in
 * `../form-context-production.tsx`; tests supply their own.
 */
export type FormContext = {
  viewer: { userId: Accessor<string | undefined> };
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
  /** Open the form's shared layout for editing, under the current owner. */
  createLayoutCollaboration: (formId: string) => FormLayoutCollaboration;
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
    submit: (
      formId: string,
      answers: SubmittedAnswer[]
    ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
    editMine: (
      formId: string,
      answers: SubmittedAnswer[]
    ) => ResultAsync<SubmitOutcome, FormWriteFailure>;
    createMine: (formId: Accessor<string | undefined>) => MyResponseSource;
    createSummary: (
      formId: Accessor<string>,
      enabled: Accessor<boolean>
    ) => ReadSource<ResponseCounts>;
    createTally: (
      formId: Accessor<string>,
      enabled: Accessor<boolean>
    ) => ReadSource<QuestionTally[]>;
    /** People in the channels a form was posted to, its owner excluded. */
    createInvited: (
      formId: Accessor<string>,
      ownerId: Accessor<string>,
      enabled: Accessor<boolean>
    ) => ReadSource<number | null>;
    /** Download the linked table as CSV, the grid's own export. */
    exportCsv: (
      databaseId: string,
      tableId: string
    ) => ResultAsync<void, FormWriteFailure>;
  };
  /** Upload a file for a file question; answers the link the cell stores. */
  uploadFile: (file: File) => ResultAsync<string, FormWriteFailure>;
  booking: FormBooking;
  /** Open a direct conversation with the form's owner (stop screen, RFC 02 §4). */
  messageOwner: (ownerId: string) => ResultAsync<void, FormWriteFailure>;
  notify: {
    success: (message: string) => void;
    failure: (message: string) => void;
  };
  ui: {
    renderEntityPicker: (props: EntityPickerProps) => JSX.Element;
    renderRelationPicker: (props: RelationPickerProps) => JSX.Element;
    renderConditionEditor: (props: ConditionEditorProps) => JSX.Element;
    renderResponsesGrid: (props: ResponsesGridProps) => JSX.Element;
    /** A person's or entity's name, as mentions show it. */
    renderEntityLabel: (entity: FormEntityReference) => JSX.Element;
    /** The other editors who selected something, as the app shows people. */
    renderEditors: (props: EditorsProps) => JSX.Element;
  };
};

const Context = createContext<FormContext>();

export const FormProvider = Context.Provider;

export function useFormContext(): FormContext {
  const context = useContext(Context);
  if (!context) throw new Error('FormProvider is required');
  return context;
}

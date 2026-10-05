/**
 * The vocabulary of Macro Forms: a form is a view of one database table. Its
 * questions are the table's columns; the form owns only presentation
 * (sections, order, help text, required, widget, gate rules).
 *
 * The shapes follow the service's wire types, but core never imports them.
 * Sections are an editor projection: the wire's questions-or-gate union is
 * flattened into one shape (a questions section has no rules; a gate has no
 * questions), converted both ways in `queries/form-detail.ts`.
 */

/** Who may respond: signed-in Macro users, or anyone with the link. */
export type FormAudience = 'members' | 'public';

export type FormStatus = 'open' | 'closed';

/** What the viewer may do: view = respond; edit = build, and edit responses (edit on the linked database). */
export type FormAccess = 'view' | 'edit' | 'owner';

export type SectionKind = 'questions' | 'gate';

/** How a column is asked; only narrows presentation (RFC 01 §4). */
export type QuestionWidget =
  | 'short'
  | 'paragraph'
  | 'datetime'
  | 'date'
  | 'url'
  | 'file'
  | 'choice'
  | 'dropdown'
  | 'checkboxes';

/** A kind of Macro entity a reference column points at. */
export type FormEntityKind =
  | 'USER'
  | 'DOCUMENT'
  | 'TASK'
  | 'COMPANY'
  | 'CONTACT'
  | 'CALL_RECORD'
  | 'CHANNEL'
  | 'CHAT'
  | 'PROJECT'
  | 'THREAD'
  | 'CALENDAR_EVENT'
  | 'INITIATIVE';

/** A column's type, as the database ops spell it. */
export type FormColumnKind =
  | { type: 'text' }
  | { type: 'number' }
  | { type: 'boolean' }
  | { type: 'date' }
  | { type: 'link' }
  | { type: 'select'; multi: boolean }
  | { type: 'select_number'; multi: boolean }
  | { type: 'tag' }
  | { type: 'entity'; target: FormEntityKind; multi: boolean }
  | { type: 'relation'; database: string; table: string };

export type FormOption = {
  id: string;
  label: string;
  color: string | null;
};

/** The facts a column owns: its name, type and options. */
export type FormColumn = {
  id: string;
  name: string;
  kind: FormColumnKind;
  options: FormOption[];
};

/** A select option, by id; the respond page only ever names options by id. */
export type FormOptionReference = { id: string } | { label: string };

export type FormEntityReference = {
  entityType: FormEntityKind;
  entityId: string;
};

/** A cell's value, as `CellValue` spells it. */
export type FormCellValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'link'; value: string[] }
  | { type: 'options'; value: FormOptionReference[] }
  | { type: 'entities'; value: FormEntityReference[] }
  | { type: 'rows'; value: string[] }
  | { type: 'clear' };

export type GateConjunction = 'and' | 'or';
export type PresenceOperator = 'isEmpty' | 'isNotEmpty';
export type TextOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'doesNotContain'
  | 'startsWith'
  | 'endsWith';
export type NumberOperator =
  | 'is'
  | 'isNot'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual';
export type DateOperator = 'before' | 'after' | 'onOrBefore' | 'onOrAfter';
export type SetOperator =
  | 'isAnyOf'
  | 'isNoneOf'
  | 'hasAny'
  | 'hasAll'
  | 'hasNone';

/** What a column's answer must be; `FilterTest` of a database view. */
export type GateTest =
  | { kind: 'presence'; operator: PresenceOperator }
  | { kind: 'text'; operator: TextOperator; value: string }
  | { kind: 'number'; operator: NumberOperator; value: number }
  | { kind: 'date'; operator: DateOperator; value: string }
  | { kind: 'checkbox'; checked: boolean }
  | { kind: 'options'; operator: SetOperator; options: string[] }
  | { kind: 'entities'; operator: SetOperator; entities: string[] };

export type GateCondition = { column: string; test: GateTest };

export type GateNode =
  | ({ kind: 'condition' } & GateCondition)
  | ({ kind: 'group' } & GateRules);

/** A gate's rules: a database view's `FilterGroup`. */
export type GateRules = {
  conjunction: GateConjunction;
  conditions: GateNode[];
};

/** A question: one column of the table, asked a certain way. */
export type FormQuestion = {
  id: string;
  columnId: string;
  helpText: string;
  required: boolean;
  widget: QuestionWidget | null;
};

export type FormSection = {
  id: string;
  title: string;
  description: string;
  kind: SectionKind;
  /** Only a gate has rules; they name columns of earlier sections' questions. */
  gateRules: GateRules | null;
  gateMessage: string;
  questions: FormQuestion[];
};

/** Everything the form owns about presentation, in order. */
export type FormLayout = { sections: FormSection[] };

export type FormMetadata = {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  databaseId: string;
  tableId: string;
  audience: FormAudience;
  status: FormStatus;
  closesAt: string | null;
  tallyVisible: boolean;
  confirmationMessage: string;
  submittedColumnId: string | null;
  respondentColumnId: string | null;
};

/** A form as one viewer reads it: never rows, only columns the questions ask. */
export type FormDetail = {
  form: FormMetadata;
  layout: FormLayout;
  /** The facts of every column a question asks, by column id. */
  columns: FormColumn[];
  access: FormAccess;
  /** The linked table is gone or its database trashed; submissions are refused. */
  tableGone: boolean;
};

/** Where the builder's layout saves stand. */
export type SaveState = 'saved' | 'pending' | 'saving' | 'failed';

/** Answers kept in memory until submit, by question id. */
export type FormAnswers = Record<string, FormCellValue>;

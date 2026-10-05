import { match } from 'ts-pattern';
import type {
  FormColumnKind,
  FormEntityKind,
  QuestionWidget,
} from './form-model';

/** A question type as the builder's type menu names it. */
export type QuestionTypeId =
  | 'short'
  | 'paragraph'
  | 'number'
  | 'choice'
  | 'checkboxes'
  | 'dropdown'
  | 'file'
  | 'datetime'
  | 'date'
  | 'url'
  | 'checkbox'
  | 'person'
  | 'document'
  | 'relation'
  | 'number-dropdown'
  | 'tags'
  | 'entity';

/** What a type is stored as: a column kind and how it is asked. */
export type QuestionTypeChoice = {
  id: QuestionTypeId;
  label: string;
  group: 'forms' | 'macro';
  /** A relation names its table when chosen, so it has no kind until then. */
  kind: FormColumnKind | 'pick-table';
  widget: QuestionWidget | null;
};

/** The type menu: the Google Forms list, then Macro's own. */
export const QUESTION_TYPE_CHOICES: readonly QuestionTypeChoice[] = [
  {
    id: 'short',
    label: 'Short answer',
    group: 'forms',
    kind: { type: 'text' },
    widget: 'short',
  },
  {
    id: 'paragraph',
    label: 'Paragraph',
    group: 'forms',
    kind: { type: 'text' },
    widget: 'paragraph',
  },
  {
    id: 'choice',
    label: 'Multiple choice',
    group: 'forms',
    kind: { type: 'select', multi: false },
    widget: 'choice',
  },
  {
    id: 'checkboxes',
    label: 'Checkboxes',
    group: 'forms',
    kind: { type: 'select', multi: true },
    widget: 'checkboxes',
  },
  {
    id: 'dropdown',
    label: 'Dropdown',
    group: 'forms',
    kind: { type: 'select', multi: false },
    widget: 'dropdown',
  },
  {
    id: 'file',
    label: 'File upload',
    group: 'forms',
    kind: { type: 'link' },
    widget: 'file',
  },
  {
    id: 'number',
    label: 'Number',
    group: 'forms',
    kind: { type: 'number' },
    widget: null,
  },
  {
    id: 'datetime',
    label: 'Date & time',
    group: 'forms',
    kind: { type: 'date' },
    widget: 'datetime',
  },
  {
    id: 'date',
    label: 'Date',
    group: 'forms',
    kind: { type: 'date' },
    widget: 'date',
  },
  {
    id: 'url',
    label: 'Link',
    group: 'forms',
    kind: { type: 'link' },
    widget: 'url',
  },
  {
    id: 'checkbox',
    label: 'Checkbox',
    group: 'macro',
    kind: { type: 'boolean' },
    widget: null,
  },
  {
    id: 'person',
    label: 'Person',
    group: 'macro',
    kind: { type: 'entity', target: 'USER', multi: false },
    widget: null,
  },
  {
    id: 'document',
    label: 'Document',
    group: 'macro',
    kind: { type: 'entity', target: 'DOCUMENT', multi: false },
    widget: null,
  },
  {
    id: 'relation',
    label: 'Database row',
    group: 'macro',
    kind: 'pick-table',
    widget: null,
  },
];

/** The widgets a column kind can be asked with, its default first (RFC 01 §4). */
export function widgetsFor(kind: FormColumnKind): QuestionWidget[] {
  return match(kind)
    .returnType<QuestionWidget[]>()
    .with({ type: 'text' }, () => ['short', 'paragraph'])
    .with({ type: 'date' }, () => ['datetime', 'date'])
    .with({ type: 'link' }, () => ['url', 'file'])
    .with({ type: 'select', multi: false }, () => ['choice', 'dropdown'])
    .with({ type: 'select', multi: true }, () => ['checkboxes'])
    .with({ type: 'select_number' }, () => ['dropdown'])
    .with({ type: 'tag' }, () => ['checkboxes'])
    .with(
      { type: 'number' },
      { type: 'boolean' },
      { type: 'entity' },
      { type: 'relation' },
      () => []
    )
    .exhaustive();
}

/** The widget a question shows with: its own, or its kind's default. */
export function resolvedWidget(
  kind: FormColumnKind,
  widget: QuestionWidget | null
): QuestionWidget | null {
  const fits = widgetsFor(kind);
  if (widget && fits.includes(widget)) return widget;
  return fits[0] ?? null;
}

export function widgetFits(
  kind: FormColumnKind,
  widget: QuestionWidget | null
): boolean {
  return widget === null || widgetsFor(kind).includes(widget);
}

const ENTITY_LABELS: Record<FormEntityKind, string> = {
  USER: 'Person',
  DOCUMENT: 'Document',
  TASK: 'Task',
  COMPANY: 'Company',
  CONTACT: 'Contact',
  CALL_RECORD: 'Call',
  CHANNEL: 'Channel',
  CHAT: 'Chat',
  PROJECT: 'Project',
  THREAD: 'Email thread',
  CALENDAR_EVENT: 'Calendar event',
  INITIATIVE: 'Initiative',
};

/** The type a column and widget read as in the builder. */
export function questionTypeOf(
  kind: FormColumnKind,
  widget: QuestionWidget | null
): QuestionTypeId {
  const shown = resolvedWidget(kind, widget);
  return match(kind)
    .returnType<QuestionTypeId>()
    .with({ type: 'text' }, () =>
      shown === 'paragraph' ? 'paragraph' : 'short'
    )
    .with({ type: 'number' }, () => 'number')
    .with({ type: 'boolean' }, () => 'checkbox')
    .with({ type: 'date' }, () => (shown === 'date' ? 'date' : 'datetime'))
    .with({ type: 'link' }, () => (shown === 'file' ? 'file' : 'url'))
    .with({ type: 'select', multi: false }, () =>
      shown === 'dropdown' ? 'dropdown' : 'choice'
    )
    .with({ type: 'select', multi: true }, () => 'checkboxes')
    .with({ type: 'select_number' }, () => 'number-dropdown')
    .with({ type: 'tag' }, () => 'tags')
    .with({ type: 'entity', target: 'USER', multi: false }, () => 'person')
    .with(
      { type: 'entity', target: 'DOCUMENT', multi: false },
      () => 'document'
    )
    .with({ type: 'entity' }, () => 'entity')
    .with({ type: 'relation' }, () => 'relation')
    .exhaustive();
}

/** The chip label of a question's type. */
export function questionTypeLabel(
  kind: FormColumnKind,
  widget: QuestionWidget | null
): string {
  const id = questionTypeOf(kind, widget);
  const listed = QUESTION_TYPE_CHOICES.find((choice) => choice.id === id);
  if (listed) return listed.label;
  return (
    match(kind)
      .with({ type: 'select_number' }, () => 'Number dropdown')
      .with({ type: 'tag' }, () => 'Tags')
      .with(
        { type: 'entity' },
        ({ target, multi }) => `${ENTITY_LABELS[target]}${multi ? 's' : ''}`
      )
      // Every other kind has a listed choice for each of its widgets.
      .with(
        { type: 'text' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'date' },
        { type: 'link' },
        { type: 'select' },
        { type: 'relation' },
        () => 'Question'
      )
      .exhaustive()
  );
}

/** Whether two kinds are the same column type, compared fact by fact. */
export function sameColumnKind(
  left: FormColumnKind,
  right: FormColumnKind
): boolean {
  return match(left)
    .with(
      { type: 'text' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'date' },
      { type: 'link' },
      { type: 'tag' },
      (one) => right.type === one.type
    )
    .with(
      { type: 'select' },
      (one) => right.type === 'select' && right.multi === one.multi
    )
    .with(
      { type: 'select_number' },
      (one) => right.type === 'select_number' && right.multi === one.multi
    )
    .with(
      { type: 'entity' },
      (one) =>
        right.type === 'entity' &&
        right.target === one.target &&
        right.multi === one.multi
    )
    .with(
      { type: 'relation' },
      (one) =>
        right.type === 'relation' &&
        right.database === one.database &&
        right.table === one.table
    )
    .exhaustive();
}

/** Whether a kind's answers are picked from options the column owns. */
export function hasOptions(kind: FormColumnKind): boolean {
  return (
    kind.type === 'select' ||
    kind.type === 'select_number' ||
    kind.type === 'tag'
  );
}

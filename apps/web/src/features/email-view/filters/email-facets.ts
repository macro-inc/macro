import {
  hasCalendarInviteFilter,
  hasDocumentAttachmentFilter,
  hasImageAttachmentFilter,
  hasPdfAttachmentFilter,
} from '@app/features/next-soup/filters/predicates';
import {
  clause,
  type Facet,
  type FacetOption,
  TAG_FACET_ID,
  type TagFacetContext,
  tagFacetOption,
} from '@app/features/soup';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import type { EmailEntity, EmailFocus, EntityData } from '@entity';
import type { EmailFilterGroupId, EmailFilterOptionId } from '../types';

type EmailFilterOption = {
  id: EmailFilterOptionId;
  label: string;
  iconType?: EntityIconSelector;
};

/** Tags are the one facet whose options come from data rather than a list. */
export type EmailFacetContext = TagFacetContext;

type EmailFacetOption = FacetOption<EmailEntity, EmailFacetContext> &
  EmailFilterOption;

function readOption(
  id: EmailFilterOptionId,
  label: string,
  seen: boolean
): EmailFacetOption {
  return {
    id,
    label,
    clause: { ef: clause.eq('emailSeen', seen) },
    predicate: (email) => email.isRead === seen,
  };
}

function doneOption(
  id: EmailFilterOptionId,
  label: string,
  done: boolean
): EmailFacetOption {
  return {
    id,
    label,
    clause: { ef: clause.eq('emailDone', done) },
    predicate: (email) => email.done === done,
  };
}

/** The server's attachment kind for each attachment filter. */
export const EMAIL_ATTACHMENT_KINDS = {
  'attachment-pdf': 'pdf',
  'attachment-image': 'image',
  'attachment-document': 'document',
} as const;

// Built-in tabs refine loaded pages client-side from each thread's attachment
// mime types, as the legacy mail view did. Saved views add the server's
// attachment-kind filter (`email-query.ts`), which needs backfilled thread flags.
function attachmentOption(
  id: keyof typeof EMAIL_ATTACHMENT_KINDS,
  label: string,
  iconType: EntityIconSelector,
  predicate: (entity: EntityData) => boolean
): EmailFacetOption {
  return { id, label, iconType, predicate };
}

const EMAIL_READ_OPTIONS: EmailFacetOption[] = [
  readOption('unread', 'Unread', false),
  readOption('read', 'Read', true),
];

const EMAIL_DONE_OPTIONS: EmailFacetOption[] = [
  doneOption('not-done', 'Not done', false),
  doneOption('done', 'Done', true),
];

const EMAIL_ATTACHMENT_OPTIONS: EmailFacetOption[] = [
  attachmentOption('attachment-pdf', 'PDFs', 'pdf', hasPdfAttachmentFilter),
  attachmentOption(
    'attachment-image',
    'Images',
    'image',
    hasImageAttachmentFilter
  ),
  attachmentOption(
    'attachment-document',
    'Documents',
    'files',
    hasDocumentAttachmentFilter
  ),
];

const EMAIL_CALENDAR_OPTIONS: EmailFacetOption[] = [
  {
    id: 'has-calendar-invite',
    label: 'Calendar invite',
    iconType: 'calendar',
    clause: { ef: clause.eq('emailCalendarOnly', true) },
    predicate: hasCalendarInviteFilter,
  },
];

// Focus rows carry their classification; other rows never match these.
function focusOption(
  id: EmailFilterOptionId,
  label: string,
  predicate: (focus: EmailFocus) => boolean
): EmailFacetOption {
  return {
    id,
    label,
    predicate: (email) => email.focus !== undefined && predicate(email.focus),
  };
}

const EMAIL_FOCUS_OPTIONS: EmailFacetOption[] = [
  focusOption(
    'focus-reply-needed',
    'Reply needed',
    (focus) => focus.needsReply
  ),
  focusOption('focus-follow-up', 'Follow up', (focus) => focus.needsFollowUp),
];

export const EMAIL_FACETS: Facet<EmailEntity, EmailFacetContext>[] = [
  { id: 'read', mode: 'or', options: EMAIL_READ_OPTIONS },
  { id: 'done', mode: 'or', options: EMAIL_DONE_OPTIONS },
  { id: 'attachments', mode: 'or', options: EMAIL_ATTACHMENT_OPTIONS },
  { id: 'calendar', mode: 'or', options: EMAIL_CALENDAR_OPTIONS },
  { id: 'focus', mode: 'or', options: EMAIL_FOCUS_OPTIONS },
  {
    id: TAG_FACET_ID,
    mode: 'or',
    options: (optionId, context) =>
      tagFacetOption<EmailEntity>(optionId, context),
  },
];

type EmailFilterGroup = {
  id: EmailFilterGroupId;
  label: string;
  selectionMode?: 'single' | 'multiple';
  /** The option that stands for "no selection" in a single-select group. */
  defaultOptionId?: EmailFilterOptionId;
  options: EmailFilterOption[];
};

const toGroupOptions = (options: EmailFacetOption[]) =>
  options.map(({ id, label, iconType }) => ({ id, label, iconType }));

/** The Focus tab's flag menu; shown only there, first. */
export const EMAIL_FOCUS_FILTER_GROUP: EmailFilterGroup = {
  id: 'focus',
  label: 'Focus',
  selectionMode: 'single',
  defaultOptionId: 'all',
  options: [
    ...toGroupOptions(EMAIL_FOCUS_OPTIONS),
    { id: 'all', label: 'All' },
  ],
};

/** Filter menu layout: the legacy mail filters, split into single-select status groups. */
export const EMAIL_FILTER_GROUPS: EmailFilterGroup[] = [
  {
    id: 'read',
    label: 'Read status',
    selectionMode: 'single',
    defaultOptionId: 'all',
    options: [
      ...toGroupOptions(EMAIL_READ_OPTIONS),
      { id: 'all', label: 'All' },
    ],
  },
  {
    id: 'done',
    label: 'Done',
    selectionMode: 'single',
    defaultOptionId: 'all',
    options: [
      ...toGroupOptions(EMAIL_DONE_OPTIONS),
      { id: 'all', label: 'All' },
    ],
  },
  // Ticked items must all hold; a view's Starred joins them where it applies.
  {
    id: 'has',
    label: 'Has',
    options: toGroupOptions(EMAIL_CALENDAR_OPTIONS),
  },
  {
    id: 'attachments',
    label: 'Attachments',
    options: toGroupOptions(EMAIL_ATTACHMENT_OPTIONS),
  },
];

/** The calendar facet's options, which the "Has" group writes. */
export const EMAIL_CALENDAR_OPTION_IDS = EMAIL_CALENDAR_OPTIONS.map(
  ({ id }) => id
);

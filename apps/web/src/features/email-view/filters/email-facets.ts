import {
  hasCalendarInviteFilter,
  hasDocumentAttachmentFilter,
  hasImageAttachmentFilter,
  hasPdfAttachmentFilter,
} from '@app/features/next-soup/filters/predicates';
import { clause, type Facet, type FacetOption } from '@app/features/soup';
import type { EntityIconSelector } from '@core/component/EntityIcon';
import type { EmailEntity, EntityData } from '@entity';
import type { EmailFilterGroupId, EmailFilterOptionId } from '../types';

type EmailFilterOption = {
  id: EmailFilterOptionId;
  label: string;
  iconType?: EntityIconSelector;
};

type EmailFacetOption = FacetOption<EmailEntity, undefined> & EmailFilterOption;

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

// Attachments have no server filter: the page is refined client-side from
// each thread's attachment mime types, as the legacy mail view did.
function attachmentOption(
  id: EmailFilterOptionId,
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
    label: 'Has calendar invite',
    iconType: 'calendar',
    clause: { ef: clause.eq('emailCalendarOnly', true) },
    predicate: hasCalendarInviteFilter,
  },
];

export const EMAIL_FACETS: Facet<EmailEntity, undefined, EmailFacetOption>[] = [
  { id: 'read', mode: 'or', options: EMAIL_READ_OPTIONS },
  { id: 'done', mode: 'or', options: EMAIL_DONE_OPTIONS },
  { id: 'attachments', mode: 'or', options: EMAIL_ATTACHMENT_OPTIONS },
  { id: 'calendar', mode: 'or', options: EMAIL_CALENDAR_OPTIONS },
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

/** Filter menu layout: the legacy mail filters, split into single-select status groups. */
export const EMAIL_FILTER_GROUPS: EmailFilterGroup[] = [
  {
    id: 'read',
    label: 'Status',
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
  {
    id: 'attachments',
    label: 'Attachments',
    options: toGroupOptions(EMAIL_ATTACHMENT_OPTIONS),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    options: toGroupOptions(EMAIL_CALENDAR_OPTIONS),
  },
];

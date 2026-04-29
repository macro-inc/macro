import {
  emailDraftsFilter as emailDraftsPredicate,
  noDraftsFilter as noDraftsPredicate,
  hasCalendarInviteFilter as hasCalendarInvitePredicate,
  hasAttachmentFilter as hasAttachmentPredicate,
  hasPdfAttachmentFilter as hasPdfAttachmentPredicate,
  hasImageAttachmentFilter as hasImageAttachmentPredicate,
  hasDocumentAttachmentFilter as hasDocumentAttachmentPredicate,
} from '../predicates';
import { config, isEmail } from './base';

export const emailDraftsFilter = config({
  id: 'email-drafts',
  predicate: emailDraftsPredicate,
  query: { ...isEmail, emailView: 'drafts' },
});

export const noDraftsFilter = config({
  id: 'no-drafts',
  predicate: noDraftsPredicate,
  query: isEmail,
});

export const hasCalendarInviteFilter = config({
  id: 'has-calendar-invite',
  predicate: hasCalendarInvitePredicate,
  query: isEmail,
});

export const hasAttachmentFilter = config({
  id: 'has-attachment',
  predicate: hasAttachmentPredicate,
  query: isEmail,
});

export const attachmentPdfFilter = config({
  id: 'attachment-pdf',
  predicate: hasPdfAttachmentPredicate,
  query: isEmail,
});

export const attachmentImageFilter = config({
  id: 'attachment-image',
  predicate: hasImageAttachmentPredicate,
  query: isEmail,
});

export const attachmentDocumentFilter = config({
  id: 'attachment-document',
  predicate: hasDocumentAttachmentPredicate,
  query: isEmail,
});

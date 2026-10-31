import { t } from '@app/lib/i18n';
import {
  type ContactFailure,
  MarketingError,
  type MarketingErrorCode,
} from '../core/errors';
import { isEnrollmentErrorCode } from '../core/model';

type SingleCode = Exclude<MarketingErrorCode, 'contactsFailed'>;

const KEYS = {
  nameRequired: 'emailMarketing.errorNameRequired',
  senderRequired: 'emailMarketing.errorSenderRequired',
  stepsRequired: 'emailMarketing.errorStepsRequired',
  subjectSingleLine: 'emailMarketing.errorSubjectSingleLine',
  subjectRequired: 'emailMarketing.errorSubjectRequired',
  bodyRequired: 'emailMarketing.errorBodyRequired',
  optOutRequired: 'emailMarketing.errorOptOutRequired',
  delayRange: 'emailMarketing.errorDelayRange',
  unknownPersonalization: 'emailMarketing.errorUnknownPersonalization',
  sequenceTooLong: 'emailMarketing.errorSequenceTooLong',
  sequenceTooLarge: 'emailMarketing.errorSequenceTooLarge',
  invalidStartTime: 'emailMarketing.errorInvalidStartTime',
  startTooSoon: 'emailMarketing.errorStartTooSoon',
  schedulingTooSlow: 'emailMarketing.errorSchedulingTooSlow',
  inboxDisconnected: 'emailMarketing.errorInboxDisconnected',
  inboxReauth: 'emailMarketing.errorInboxReauth',
  inboxesLoading: 'emailMarketing.errorInboxesLoading',
  campaignInactive: 'emailMarketing.errorCampaignInactive',
  campaignChanged: 'emailMarketing.errorCampaignChanged',
  activateFirst: 'emailMarketing.errorActivateFirst',
  invalidEmail: 'emailMarketing.errorInvalidEmail',
  alreadyEnrolled: 'emailMarketing.errorAlreadyEnrolled',
  unsubscribed: 'emailMarketing.errorUnsubscribed',
  unreadableRecords: 'emailMarketing.errorUnreadableRecords',
  enrollmentStopped: 'emailMarketing.errorEnrollmentStopped',
  enrollmentChanged: 'emailMarketing.errorEnrollmentChanged',
  enrollmentMissing: 'emailMarketing.errorEnrollmentMissing',
  notPaused: 'emailMarketing.errorNotPaused',
  nothingToResume: 'emailMarketing.errorNothingToResume',
  scheduleFailed: 'emailMarketing.errorScheduleFailed',
  cancelFailed: 'emailMarketing.errorCancelFailed',
  cancelKeepsChanging: 'emailMarketing.errorCancelKeepsChanging',
  draftIdMissing: 'emailMarketing.errorDraftIdMissing',
  columnMissing: 'emailMarketing.errorColumnMissing',
  needEditAccess: 'emailMarketing.errorNeedEditAccess',
  storageUnavailable: 'emailMarketing.errorStorageUnavailable',
  changedElsewhere: 'emailMarketing.errorChangedElsewhere',
  refreshFailed: 'emailMarketing.errorRefreshFailed',
} as const satisfies Record<SingleCode, string>;

function single(error: MarketingError) {
  if (error.code === 'contactsFailed') return '';
  return t(KEYS[error.code], error.params);
}

/** A failure from this feature or a service, in the interface language. */
export function errorMessage(error: unknown): string {
  if (error instanceof MarketingError) {
    if (!error.failures.length) return single(error);
    const lines = error.failures.map((failure) => failureLine(failure));
    if (error.code !== 'contactsFailed') lines.unshift(single(error));
    return lines.join('\n');
  }
  // A service's own text explains it best, in a translated frame.
  return t('emailMarketing.errorUnexpected', {
    detail: error instanceof Error ? error.message : String(error),
  });
}

function failureLine(failure: ContactFailure) {
  const message = errorMessage(failure.error);
  // Contact-specific messages already name the address.
  return message.includes(failure.email)
    ? message
    : t('emailMarketing.errorForContact', { email: failure.email, message });
}

/** A stored enrollment error: a code, or text from records written before codes. */
export function enrollmentErrorMessage(error: string) {
  return isEnrollmentErrorCode(error) ? t(KEYS[error]) : error;
}

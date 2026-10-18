import type { MessagingProvider } from './delivery';

export type HistoryImport = {
  status:
    | 'not_requested'
    | 'pending'
    | 'syncing'
    | 'complete'
    | 'declined'
    | 'failed';
  progress?: number | null;
  error_code?: string | null;
  unavailable_media: boolean;
};

export function historyActive(job?: HistoryImport | null) {
  return job?.status === 'pending' || job?.status === 'syncing';
}

export function historyLabel(job?: HistoryImport | null) {
  if (historyActive(job)) return 'Importing history…';
  if (job?.status === 'complete') return 'History imported';
  if (job?.status === 'failed') return 'Review import';
  if (job?.status === 'declined') return 'History not shared';
  return 'Import history';
}

export function historyDescription(provider: MessagingProvider) {
  return provider === 'whatsapp'
    ? 'Import available one-to-one conversations from the last six months. WhatsApp requires history sharing during Business-app setup and import within 24 hours. Attachments are available only from the last 14 days.'
    : 'Import all conversations Instagram makes available, with up to the latest 20 messages in each. Message requests inactive for more than 30 days and older messages aren’t available through Meta.';
}

export function historyRecovery(
  job: HistoryImport,
  provider: MessagingProvider
) {
  if (job.status === 'declined')
    return 'History sharing was declined in WhatsApp. To import, disconnect the Business Platform in WhatsApp Business and complete setup again with history sharing enabled.';
  if (job.error_code === 'history_meta_access_required')
    return 'Meta hasn’t granted this app access to the account’s history. Check the app’s status and messaging permissions in Meta, then resume the import.';
  if (job.error_code === 'history_permission_lost')
    return 'The administrator who started this import no longer has access. Restore administrator access before continuing.';
  if (job.error_code === 'history_reconnect_required')
    return 'Reconnect this account to restore Meta access. Messages already imported are kept.';
  return provider === 'whatsapp'
    ? 'WhatsApp hasn’t confirmed the import. Messages already received are kept, and late history can still arrive. If it doesn’t, disconnect the Business Platform in WhatsApp Business and complete setup again with history sharing enabled.'
    : 'Instagram couldn’t finish the import. Check the account’s messaging access, then resume. Messages already imported won’t be duplicated.';
}

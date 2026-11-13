import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import type { CertificateEvent } from '../core/certificate';

/** One sentence for an entry in a packet's activity log. */
export function describeEvent(event: CertificateEvent): string {
  const actor = event.actor;
  const name = event.recipientName ?? event.actor;

  return match(event.type)
    .with('contract.created', () => t('contracts.activityCreated', { actor }))
    .with('contract.sent', () => t('contracts.activitySent', { name }))
    .with('contract.viewed', () => t('contracts.activityViewed', { name }))
    .with('contract.signed_by_recipient', () =>
      t('contracts.activitySigned', { name })
    )
    .with('contract.completed', () => t('contracts.activityCompleted'))
    .with('contract.declined', () => t('contracts.activityDeclined', { name }))
    .with('contract.voided', () => t('contracts.activityVoided', { actor }))
    .with('contract.expired', () => t('contracts.activityExpired'))
    .with('audit.disclosure_accepted', () =>
      t('contracts.activityDisclosure', { name })
    )
    .with('audit.reminder_sent', () =>
      t('contracts.activityReminder', { name })
    )
    .with('audit.documents_replaced', () =>
      t('contracts.activityDocumentsReplaced', { actor })
    )
    .with('audit.status_overridden', () =>
      t('contracts.activityOverridden', { actor })
    )
    .exhaustive();
}

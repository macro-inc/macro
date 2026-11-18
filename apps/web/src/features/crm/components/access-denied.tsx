import { t } from '@app/lib/i18n';
import { EmptyStatePanel } from '@ui';
import { Show } from 'solid-js';
import { CrmListSkeleton } from './list-state';

export function CrmAccessDenied() {
  return (
    <EmptyStatePanel
      centered
      title={t('crm.accessDenied')}
      description={t('crm.accessDeniedHelp')}
    />
  );
}

/** A cold deep link waits for proof; only a proven denial shows the denied state. */
export function CrmAccessFallback(props: {
  state: 'pending' | 'allowed' | 'denied';
}) {
  return (
    <Show
      when={props.state === 'denied'}
      fallback={<CrmListSkeleton label={t('common.loading')} />}
    >
      <CrmAccessDenied />
    </Show>
  );
}

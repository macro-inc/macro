import { t } from '@app/lib/i18n';
import { EmptyStatePanel } from '@ui';
import { Match, Switch } from 'solid-js';
import { CrmListError, CrmListSkeleton } from './list-state';

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
  state: 'pending' | 'allowed' | 'denied' | 'error';
  onRetry: () => Promise<unknown>;
}) {
  return (
    <Switch fallback={<CrmListSkeleton label={t('common.loading')} />}>
      <Match when={props.state === 'denied'}>
        <CrmAccessDenied />
      </Match>
      <Match when={props.state === 'error'}>
        <CrmListError onRetry={props.onRetry} />
      </Match>
    </Switch>
  );
}

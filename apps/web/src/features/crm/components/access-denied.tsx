import { t } from '@app/lib/i18n';
import { EmptyStatePanel } from '@ui';

export function CrmAccessDenied() {
  return (
    <EmptyStatePanel
      centered
      title={t('crm.accessDenied')}
      description={t('crm.accessDeniedHelp')}
    />
  );
}

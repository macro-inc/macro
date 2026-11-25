import { formatLocale, t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { createEffect, on, Show } from 'solid-js';
import { CrmProvider } from './context/crm-context';
import { createAppCrmContext } from './crm-adapter';
import { companyMerge } from './crm-merge';
import { MergeCompaniesDialog } from './views/merge-companies-dialog';

/** The app's one merge dialog, opened by `openMergeCompanies`. */
export function CompanyMergeModal() {
  const { openWithSplit } = useSplitLayout();
  createEffect(
    on(crmAccessAllowed, (allowed) => {
      if (!allowed) companyMerge.close();
    })
  );
  return (
    <CrmProvider value={createAppCrmContext()}>
      <Show when={companyMerge.request()} keyed>
        {(request) => (
          <MergeCompaniesDialog
            open={companyMerge.open()}
            onOpenChange={(open) => {
              if (!open) companyMerge.close();
            }}
            companies={request.companies}
            onMerged={({ survivor, merged }) => {
              request.onMerged?.();
              if (!crmAccessAllowed()) return;
              const names = new Intl.ListFormat(formatLocale(), {
                style: 'long',
                type: 'conjunction',
              }).format(merged.map((company) => company.name));
              const notice = toast.success(t('crm.mergeDone'), {
                subtext: t('crm.mergeDoneDetail', {
                  count: merged.length,
                  names,
                  name: survivor.name,
                }),
                duration: isMobile() ? undefined : 8000,
                dismissStyle: 'icon',
                actions: [
                  {
                    label: t('crm.mergeOpen'),
                    icon: ArrowSquareOutIcon,
                    trailingIcon: true,
                    onClick: () => {
                      if (notice !== undefined) toast.dismiss(notice);
                      openWithSplit({ type: 'company', id: survivor.id });
                    },
                  },
                ],
              });
            }}
          />
        )}
      </Show>
    </CrmProvider>
  );
}

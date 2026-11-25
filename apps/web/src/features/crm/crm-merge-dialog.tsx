import { formatLocale, t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import { crmAccessAllowed } from '@service-storage/crm-access-authority';
import { createEffect, on, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { CrmProvider } from './context/crm-context';
import type { MergeRecord, MergeRecordType } from './core/merge';
import { createAppCrmContext } from './crm-adapter';
import { recordMerge } from './crm-merge';
import { MergeDialog } from './views/merge-dialog';

function mergedNotice(
  recordType: MergeRecordType,
  survivor: MergeRecord,
  merged: MergeRecord[]
) {
  const names = new Intl.ListFormat(formatLocale(), {
    style: 'long',
    type: 'conjunction',
  }).format(merged.map((record) => record.name));
  const detail = { count: merged.length, names, name: survivor.name };
  return match(recordType)
    .with('company', () => ({
      title: t('crm.mergeDone'),
      subtext: t('crm.mergeDoneDetail', detail),
    }))
    .with('contact', () => ({
      title: t('crm.mergePeopleDone'),
      subtext: t('crm.mergePeopleDoneDetail', detail),
    }))
    .exhaustive();
}

/** The app's one merge dialog, opened by `openMerge`. */
export function CrmMergeModal() {
  const { openWithSplit } = useSplitLayout();
  createEffect(
    on(crmAccessAllowed, (allowed) => {
      if (!allowed) recordMerge.close();
    })
  );
  return (
    <CrmProvider value={createAppCrmContext()}>
      <Show when={recordMerge.request()} keyed>
        {(request) => (
          <MergeDialog
            open={recordMerge.open()}
            onOpenChange={(open) => {
              if (!open) recordMerge.close();
            }}
            recordType={request.recordType}
            records={request.records}
            onMerged={({ survivor, merged }) => {
              request.onMerged?.();
              if (!crmAccessAllowed()) return;
              const { title, subtext } = mergedNotice(
                request.recordType,
                survivor,
                merged
              );
              const notice = toast.success(title, {
                subtext,
                duration: isMobile() ? undefined : 8000,
                dismissStyle: 'icon',
                actions: [
                  {
                    label: t('crm.mergeOpen'),
                    icon: ArrowSquareOutIcon,
                    trailingIcon: true,
                    onClick: () => {
                      if (notice !== undefined) toast.dismiss(notice);
                      openWithSplit({
                        type: request.recordType,
                        id: survivor.id,
                      });
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

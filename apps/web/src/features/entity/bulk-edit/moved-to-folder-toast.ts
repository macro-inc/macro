import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { openFolder } from '@components/app/split-layout/open-folders';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';

/** Reports a finished move and offers to open its destination folder. */
export function toastMovedToFolder(count: number, folderId: string) {
  const open = (newSplit: boolean) => {
    if (toastId !== undefined) toast.dismiss(toastId);
    openFolder(globalSplitManager(), folderId, { newSplit });
  };
  const canOpenNewSplit =
    !isTouchDevice() && !!globalSplitManager()?.canAppendSplit();
  const toastId = toast.success(
    count > 1
      ? t('entityActions.toastMovedCount', { count })
      : t('entityActions.toastMovedToFolder'),
    {
      dismissStyle: 'icon',
      actions: [
        ...(canOpenNewSplit
          ? [
              {
                label: t('entityActions.toastOpenSplit'),
                icon: SplitIcon,
                trailingIcon: true,
                variant: 'secondary' as const,
                onClick: () => open(true),
              },
            ]
          : []),
        {
          label: t('entityActions.open'),
          icon: ArrowSquareOutIcon,
          trailingIcon: true,
          onClick: () => open(false),
        },
      ],
    }
  );
}

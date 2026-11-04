import { LIST_VIEW_ID } from '@app/constants/list-views';
import { t } from '@app/lib/i18n';
import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import ArrowRight from '@icon/system/regular/arrow-right.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';

export function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      aria-label={t('splitMenu.goBack')}
      tooltip={t('splitMenu.goBack')}
      variant="ghost"
      size="icon-md"
      disabled={!context.handle.canGoBack()}
      onClick={context.handle.goBack}
    >
      <ArrowLeft class="size-4 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}

export function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      aria-label={t('splitMenu.goForward')}
      tooltip={t('splitMenu.goForward')}
      variant="ghost"
      size="icon-md"
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
    >
      <ArrowRight class="size-4 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}

export function SplitCreateButton() {
  const context = useContext(SplitLayoutContext);
  if (!context) return '';
  return (
    <Button
      aria-label={t('splitMenu.createNewSplit')}
      tooltip={t('splitMenu.createNewSplit')}
      variant="ghost"
      size="icon-md"
      onClick={() => {
        context.manager.createNewSplit({
          content: {
            type: 'component',
            id: LIST_VIEW_ID.home,
          },
          referredFrom: 'dock',
        });
      }}
    >
      <SplitIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}

export function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      aria-label={t('splitMenu.close')}
      tooltip={t('splitMenu.close')}
      variant="ghost"
      size="icon-sm"
      onClick={context.handle.close}
    >
      <CloseIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}

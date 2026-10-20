import { LIST_VIEW_ID } from '@app/constants/list-views';
import { t } from '@app/lib/i18n';
import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import SplitIcon from '@phosphor/square-half.svg';
import CloseIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';

export function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      variant="ghost"
      size="icon-md"
      label={t('splitMenu.goBack')}
      disabled={!context.handle.canGoBack()}
      onClick={context.handle.goBack}
    >
      <ArrowLeft />
    </Button>
  );
}

export function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      variant="ghost"
      size="icon-md"
      label={t('splitMenu.goForward')}
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
    >
      <ArrowRight />
    </Button>
  );
}

export function SplitCreateButton() {
  const context = useContext(SplitLayoutContext);
  if (!context) return '';
  return (
    <Button
      variant="ghost"
      size="icon-md"
      label={t('splitMenu.createNewSplit')}
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
      <SplitIcon />
    </Button>
  );
}

export function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      variant="ghost"
      size="icon-md"
      label={t('splitMenu.close')}
      onClick={context.handle.close}
    >
      <CloseIcon />
    </Button>
  );
}

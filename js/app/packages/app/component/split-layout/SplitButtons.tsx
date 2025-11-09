import { IconButton } from '@core/component/IconButton';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import SplitIcon from '@icon/regular/square-half.svg';
import CloseIcon from '@icon/regular/x.svg';
import { useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';

export function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      icon={ArrowLeft}
      tooltip={{ label: 'Go Back' }}
      disabled={!context.handle.canGoBack()}
      theme="clear"
      onClick={context.handle.goBack}
    />
  );
}

export function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      icon={ArrowRight}
      tooltip={{ label: 'Go Forward' }}
      disabled={!context.handle.canGoForward()}
      theme="clear"
      onClick={context.handle.goForward}
    />
  );
}

export function SplitCreateButton() {
  const context = useContext(SplitLayoutContext);
  if (!context) return '';
  return (
    <IconButton
      icon={SplitIcon}
      theme="clear"
      tooltip={{ label: 'Create new split' }}
      onClick={() => {
        context.manager.createNewSplit({
          type: 'component',
          id: 'unified-list',
        });
      }}
    />
  );
}

export function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      icon={CloseIcon}
      theme="clear"
      tooltip={{ label: 'Close' }}
      onClick={context.handle.close}
    />
  );
}

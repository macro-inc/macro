import { LIST_VIEW_ID } from '@app/constants/list-views';

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
      label="Go Back"
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
      label="Go Forward"
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
      label="Create new split"
      onClick={() => {
        context.manager.createNewSplit({
          content: {
            type: 'component',
            id: LIST_VIEW_ID.inbox,
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
      label="Close"
      onClick={context.handle.close}
    >
      <CloseIcon />
    </Button>
  );
}

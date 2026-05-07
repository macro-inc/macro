import { Button } from '@ui';
import { LabelAndHotKey } from '@core/component/Tooltip';
import ArrowLeft from '@icon/regular/arrow-left.svg';
import ArrowRight from '@icon/regular/arrow-right.svg';
import SplitIcon from '@icon/regular/square-half.svg';
import CloseIcon from '@icon/regular/x.svg';
import { useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';
import { LIST_VIEW_ID } from '@app/constants/list-views';

export function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      variant="ghost"
      size="icon-md"
      tooltip={<LabelAndHotKey label="Go Back" />}
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
      tooltip={<LabelAndHotKey label="Go Forward" />}
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
      tooltip={<LabelAndHotKey label="Create new split" />}
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
      tooltip={<LabelAndHotKey label="Close" />}
      onClick={context.handle.close}
    >
      <CloseIcon />
    </Button>
  );
}

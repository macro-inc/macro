import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { blockFileSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Show } from 'solid-js';
import type { CanvasDocumentChrome } from '../component/CanvasDocument';
import { useCanvasHeaderTools } from './shared/canvas-header-parts';

/** The canvas block's header on desktop. */
export function CanvasHeader(props: { state: CanvasDocumentChrome }) {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const { ops, openShare, copyLink, actions } = useCanvasHeaderTools(
    props.state
  );

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <div class="-order-1">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        tools={[actions.askMacro]}
        trailing={
          <Show when={blockFileSignal()}>
            <ShareTrigger onClick={openShare} copyLink={copyLink} />
          </Show>
        }
        menuTools={[actions.askMacro, actions.share]}
        ops={ops}
        id={documentId}
        itemType="document"
        name={fileName()}
      />
    </>
  );
}

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
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { PdfSplitToolbar } from '../component/PdfSplitToolbar';
import { usePdfHeaderTools } from './shared/pdf-header-parts';

/**
 * The PDF block's header on desktop. Ask Macro sits among the side panel's
 * header actions.
 */
export function PdfHeader() {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const { itemType, ops, openShare, copyLink, actions } = usePdfHeaderTools();
  if (!itemType) return null;

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
      <PdfSplitToolbar />
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        trailing={<ShareTrigger onClick={openShare} copyLink={copyLink} />}
        menuTools={[actions.askMacro, actions.share]}
        ops={ops}
        id={documentId}
        itemType={itemType}
        name={fileName()}
      />
    </>
  );
}

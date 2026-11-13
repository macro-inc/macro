import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { PdfSplitToolbar } from '../../component/PdfSplitToolbar';
import { usePdfHeaderTools } from '../shared/pdf-header-parts';

/**
 * The PDF block's header on touch: the title with its menu, Ask Macro, and
 * Info, over the page toolbar.
 */
export function MobilePdfHeader() {
  const documentId = useBlockId();
  const fileName = useBlockDocumentName('Unknown Filename');
  const { itemType, ops, actions } = usePdfHeaderTools();
  if (!itemType) return null;

  return (
    <>
      <MobileBlockHeader
        id={documentId}
        name={fileName()}
        iconType="pdf"
        itemType={itemType}
        menuTools={[actions.askMacro, actions.share]}
        ops={ops}
        trailing={
          <MobileHeader.Island>
            <AskMacroButton
              grouped
              entity={{
                type: 'document',
                id: documentId,
                name: fileName(),
                fileType: blockMetadataSignal()?.fileType,
              }}
            />
          </MobileHeader.Island>
        }
      />
      <PdfSplitToolbar />
    </>
  );
}

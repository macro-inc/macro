import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import {
  FileDetailsSection,
  FilePropertiesSection,
  SidePanel,
} from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';

export function PdfSidePanelSections() {
  return (
    <>
      <SidePanel.HeaderActions>
        <PdfHeaderActions />
      </SidePanel.HeaderActions>
      <FileDetailsSection order={20} />
      <FilePropertiesSection order={30} />
    </>
  );
}

function PdfHeaderActions() {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Unknown Filename');
  const fileType = () => blockMetadataSignal()?.fileType;

  return (
    <div class="flex shrink-0 items-center gap-1">
      <AskMacroButton
        entity={{
          type: 'document',
          id: documentId,
          name: name(),
          fileType: fileType(),
        }}
      />
    </div>
  );
}

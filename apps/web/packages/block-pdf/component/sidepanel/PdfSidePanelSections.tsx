import { AskMacroButton } from '@app/component/ChatWithAgentButton';
import {
  FileDetailsSection,
  FilePropertiesSection,
  SidePanel,
} from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';

export function PdfSidePanelSections() {
  return (
    <>
      <SidePanel.Section id="actions" title="Actions" defaultOpen order={10}>
        <ActionsSectionContent />
      </SidePanel.Section>
      <FileDetailsSection order={20} />
      <FilePropertiesSection order={30} />
    </>
  );
}

function ActionsSectionContent() {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Unknown Filename');
  const fileType = () => blockMetadataSignal()?.fileType;

  return (
    <div class="m-px flex items-center justify-start gap-2">
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

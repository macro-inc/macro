import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import {
  FileDetailsSection,
  FilePropertiesSection,
  SidePanel,
} from '@components/app/side-panel';
import { useBlockId } from '@core/block';
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

  return (
    <div class="m-px flex items-center justify-start gap-2">
      <AskMacroButton
        entity={{
          type: 'document',
          id: documentId,
          name: name(),
          blockName: 'pdf',
        }}
      />
    </div>
  );
}

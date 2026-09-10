import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { DocumentDiscussion } from '@block-md/component/DocumentDiscussion';
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
      <SidePanel.Section id="actions" title="Actions" defaultOpen order={10}>
        <ActionsSectionContent />
      </SidePanel.Section>
      <FileDetailsSection order={20} />
      <FilePropertiesSection order={30} />
      <SidePanel.Section
        id="discussion"
        title="Comments"
        defaultOpen
        order={40}
      >
        <PdfDiscussion />
      </SidePanel.Section>
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

function PdfDiscussion() {
  return <DocumentDiscussion label="Comments" />;
}

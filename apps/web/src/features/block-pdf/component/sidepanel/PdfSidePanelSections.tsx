import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import { MessageDocumentDiscussion } from '@block-md/component/DocumentDiscussion';
import {
  FileDetailsSection,
  FilePropertiesSection,
  SidePanel,
} from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { blockMetadataSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Show } from 'solid-js';

export function PdfSidePanelSections() {
  return (
    <>
      <SidePanel.Section id="actions" title="Actions" defaultOpen order={10}>
        <ActionsSectionContent />
      </SidePanel.Section>
      <FileDetailsSection order={20} />
      <FilePropertiesSection order={30} />
      <Show when={isFeatureEnabled(enableUnifiedDocumentDiscussions)}>
        <SidePanel.Section
          id="discussion"
          title="Comments"
          defaultOpen
          order={40}
        >
          <MessageDocumentDiscussion label="Comments" />
        </SidePanel.Section>
      </Show>
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

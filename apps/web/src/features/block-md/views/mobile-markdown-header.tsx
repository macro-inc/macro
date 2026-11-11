import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitPermissionsBadge } from '@components/app/split-layout/components/SplitLabel';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { type Accessor, Show } from 'solid-js';
import { DispatchAgentButton } from '../component/DispatchAgentMenu';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocumentTools } from '../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../context/markdown-document-context';

/**
 * The Markdown block's header on touch, where every document and task opens
 * as this block: the title with its menu, sync state, Ask Macro, and Info.
 */
export function MobileMarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
}) {
  const { documentId, kind } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const name = () => displayName() ?? '';
  const iconType = () => (kind() === 'document' ? 'md' : kind());
  const { fileOperations, actions } = useMarkdownDocumentTools();
  // Phones don't offer version history.
  const history = () => (isMobile() ? [] : [actions.history]);

  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show
              when={isCollaborationStatusVisible(props.collaborationStatus())}
            >
              <MobileHeader.Island>
                <CollaborationStatusIndicator
                  status={props.collaborationStatus()}
                />
              </MobileHeader.Island>
            </Show>
            <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
              <MobileHeader.Island>
                <div class="flex shrink-0 items-center gap-1">
                  <Show when={kind() === 'task' && !isMobile()}>
                    <DispatchAgentButton showPrimaryLabel />
                  </Show>
                  <AskMacroButton
                    grouped
                    entity={{
                      type: 'document',
                      id: documentId(),
                      name: name(),
                      fileType: 'md',
                    }}
                  />
                </div>
              </MobileHeader.Island>
            </Show>
            <MobileHeader.Info />
          </>
        }
      >
        <MobileHeader.Title
          class="ph-no-capture"
          iconType={iconType()}
          colorIcon
          label={name()}
        />
        <Show when={kind() === 'skill'}>
          <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Skill
          </span>
        </Show>
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>

      <BlockSplitFileMenu
        id={documentId()}
        itemType="document"
        name={name()}
        ops={fileOperations}
        tools={[
          ...history(),
          actions.askMacro,
          actions.codeActions,
          actions.share,
        ]}
      />
    </>
  );
}

import { AskMacroButton } from '@app/features/chat/ChatWithAgentButton';
import type { BlockTool } from '@components/app/block-tool';
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
import { DispatchAgentButton } from '../../component/DispatchAgentMenu';
import { useMarkdownName } from '../../component/MarkdownNameProvider';
import {
  type MarkdownDocumentActions,
  useMarkdownDocumentTools,
} from '../../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../../context/markdown-document-context';
import {
  MarkdownAppearanceIcon,
  SkillBadge,
  useMarkdownHeaderEntity,
} from '../shared/markdown-header-parts';

/**
 * The title menu rows of the mobile header. Phones offer no version history,
 * and no wide mode because the document already fills the screen.
 */
export function mobileMarkdownHeaderMenu(
  actions: MarkdownDocumentActions
): BlockTool[] {
  return [
    ...(isMobile() ? [] : [actions.history, actions.wideMode]),
    actions.askMacro,
    actions.codeActions,
    actions.share,
  ];
}

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
  const headerEntity = useMarkdownHeaderEntity();

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
          icon={
            <Show when={headerEntity()}>
              {(entity) => <MarkdownAppearanceIcon entity={entity()} />}
            </Show>
          }
          label={name()}
        />
        <SkillBadge />
        <MobileHeader.Island>
          <SplitPermissionsBadge />
        </MobileHeader.Island>
      </MobileHeader>

      <BlockSplitFileMenu
        id={documentId()}
        itemType="document"
        name={name()}
        ops={fileOperations}
        tools={mobileMarkdownHeaderMenu(actions)}
        entity={headerEntity()}
      />
    </>
  );
}

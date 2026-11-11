import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
import { DesktopBlockToolbar } from '@components/app/desktop-block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { type Accessor, Show } from 'solid-js';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocumentTools } from '../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { MarkdownHeaderActions } from './desktop-markdown-header-parts';
import { SkillBadge } from './markdown-header-parts';

/** The Markdown block's header on desktop, where the block shows a preview. */
export function DesktopMarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
}) {
  const { documentId } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const { fileOperations, actions, openShare } = useMarkdownDocumentTools();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel name={displayName} />
        <SkillBadge />
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <Show when={isCollaborationStatusVisible(props.collaborationStatus())}>
          <CollaborationStatusIndicator status={props.collaborationStatus()} />
        </Show>
      </SplitHeaderRight>

      <SplitHeaderRight>
        <div class="-order-1">
          <BlockLiveIndicators />
        </div>
      </SplitHeaderRight>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <Show when={ENABLE_MARKDOWN_SIDE_PANEL}>
        <MarkdownHeaderActions />
      </Show>

      <DesktopBlockToolbar
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[
          actions.history,
          actions.askMacro,
          actions.codeActions,
          actions.share,
        ]}
        ops={fileOperations}
        id={documentId()}
        itemType="document"
        name={displayName() ?? ''}
      />
    </>
  );
}

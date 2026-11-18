import type { BlockTool } from '@components/app/block-tool';
import { BlockToolbar } from '@components/app/block-toolbar';
import {
  CollaborationStatusIndicator,
  isCollaborationStatusVisible,
} from '@components/app/CollaborationStatusIndicator';
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
import {
  type MarkdownDocumentActions,
  useMarkdownDocumentTools,
} from '../component/useMarkdownDocumentTools';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { MarkdownHeaderActions } from './markdown-header-parts';
import {
  MarkdownAppearanceIcon,
  SkillBadge,
  useMarkdownHeaderEntity,
} from './shared/markdown-header-parts';

/** The title menu rows of the desktop header. */
export function markdownHeaderMenu(
  actions: MarkdownDocumentActions
): BlockTool[] {
  return [
    actions.history,
    actions.wideMode,
    actions.askMacro,
    actions.codeActions,
    actions.share,
  ];
}

/** The Markdown block's header on desktop, where the block shows a preview. */
export function MarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
}) {
  const { documentId } = useMarkdownDocument();
  const { displayName } = useMarkdownName();
  const { fileOperations, actions, openShare } = useMarkdownDocumentTools();
  const headerEntity = useMarkdownHeaderEntity();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          name={displayName}
          icon={
            <Show when={headerEntity()}>
              {(entity) => <MarkdownAppearanceIcon entity={entity()} />}
            </Show>
          }
        />
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

      <BlockToolbar
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={markdownHeaderMenu(actions)}
        ops={fileOperations}
        id={documentId()}
        itemType="document"
        name={displayName() ?? ''}
        entity={headerEntity()}
      />
    </>
  );
}

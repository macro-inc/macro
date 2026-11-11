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
import { useBlockAliasedName, useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { ENABLE_MARKDOWN_SIDE_PANEL } from '@core/constant/featureFlags';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import type { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { type Accessor, Show } from 'solid-js';
import { useMarkdownName } from '../component/MarkdownNameProvider';
import { useMarkdownDocumentTools } from '../component/useMarkdownDocumentTools';
import { MarkdownHeaderActions } from './desktop-markdown-header-parts';

/** The Markdown block's header on desktop, where the block shows a preview. */
export function DesktopMarkdownHeader(props: {
  collaborationStatus: Accessor<SyncSourceStatus | undefined>;
}) {
  const blockId = useBlockId();
  const { displayName } = useMarkdownName();
  const fallbackName = useBlockDocumentName();
  const name = () => displayName() ?? fallbackName();
  const isSkill = useBlockAliasedName() === 'skill';
  const { fileOperations, actions, openShare } = useMarkdownDocumentTools();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel name={name} />
        <Show when={isSkill}>
          <span class="ml-1.5 inline-flex shrink-0 items-center self-center rounded-sm bg-hover px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink-muted">
            Skill
          </span>
        </Show>
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
        id={blockId}
        itemType="document"
        name={name()}
      />
    </>
  );
}

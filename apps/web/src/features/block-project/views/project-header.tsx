import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
  SplitTitleFileMenu,
} from '@components/app/split-layout/components/SplitLabel';
import { ToolButton } from '@components/app/tool-button';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { Show } from 'solid-js';
import { ProjectCreateMenu } from '../component/ProjectCreateMenu';
import { useProjectHeaderTools } from './shared/project-header-parts';

/** The project block's header on desktop: Chat, Create and Share. */
export function ProjectHeader() {
  const {
    id,
    name,
    canEdit,
    ops,
    openShare,
    handleCopyLink,
    showShare,
    CreateDialog,
    actions,
  } = useProjectHeaderTools();
  const chat = actions.chat;

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel fallbackName={name()} />
      </SplitHeaderLeft>
      <SplitHeaderRight size="md">
        <div class="order-[1000] flex items-center gap-2">
          <HeaderActionGroup label="Folder actions" size="md">
            <Show when={!chat.condition || chat.condition()}>
              {chat.buttonComponent ? (
                <chat.buttonComponent grouped />
              ) : (
                <ToolButton tool={chat} grouped />
              )}
            </Show>
          </HeaderActionGroup>
          <Show when={ops().length > 0 && canEdit()}>
            <ProjectCreateMenu id={id} name={name()} />
          </Show>
          <Show when={showShare()}>
            <ShareTrigger
              size="md"
              onClick={openShare}
              copyLink={handleCopyLink}
            />
          </Show>
        </div>
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={id}
          itemType="project"
          name={name()}
          ops={ops()}
        />
      </SplitTitleFileMenu>
      <CreateDialog />
    </>
  );
}

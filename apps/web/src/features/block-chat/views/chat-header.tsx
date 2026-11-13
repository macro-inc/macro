import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import {
  type ChatHeaderProps,
  useChatHeaderTools,
} from './shared/chat-header-parts';

/** The chat block's header on desktop. */
export function ChatHeader(props: ChatHeaderProps) {
  const { blockId, name, ops, openShare, actions } = useChatHeaderTools(props);

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel
          icon={<ProviderIcon model={props.model} class="size-4 shrink-0" />}
          fallbackName={DEFAULT_CHAT_NAME}
        />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={blockId}
        itemType="chat"
        name={name() ?? ''}
      />
    </>
  );
}

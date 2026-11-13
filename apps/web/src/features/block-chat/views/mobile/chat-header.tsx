import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import {
  type ChatHeaderProps,
  useChatHeaderTools,
} from '../shared/chat-header-parts';

/** The chat block's header on touch: the title with its menu, and Info. */
export function MobileChatHeader(props: ChatHeaderProps) {
  const { blockId, name, ops, actions } = useChatHeaderTools(props);

  return (
    <MobileBlockHeader
      id={blockId}
      name={name() ?? ''}
      iconType="chat"
      icon={<ProviderIcon model={props.model} class="size-4 shrink-0" />}
      itemType="chat"
      menuTools={[actions.share]}
      ops={ops}
    />
  );
}

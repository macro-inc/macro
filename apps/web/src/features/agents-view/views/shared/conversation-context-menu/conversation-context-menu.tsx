import type { EntityActionListState } from '@app/features/next-soup/actions';
import { SoupEntityContextMenu } from '@app/features/soup';
import type { JSX } from 'solid-js';
import { AGENTS_ACTION_VIEW_CONTEXT } from '../../../context/conversation-actions';
import type { AgentConversationEntity } from '../../../core/recent-conversations';

export function ConversationContextMenu(props: {
  conversation: AgentConversationEntity;
  focusKey?: string;
  list: EntityActionListState;
  children: JSX.Element;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <SoupEntityContextMenu
      entity={props.conversation}
      list={props.list}
      selectedEntities={() => []}
      viewContext={AGENTS_ACTION_VIEW_CONTEXT}
      as="div"
      class="block h-auto w-full shrink-0"
      onOpenChange={(open) => {
        props.onOpenChange?.(open);
        if (open) props.list.focus.set(props.focusKey ?? props.conversation.id);
      }}
    >
      {props.children}
    </SoupEntityContextMenu>
  );
}

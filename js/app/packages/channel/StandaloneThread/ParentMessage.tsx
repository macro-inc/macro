import { Show } from 'solid-js';
import { Message, type MessageActions } from '../Message';
import { useStandaloneThread } from './context';

type ParentMessageProps = {
  actions?: MessageActions;
  onClickMessage?: (messageId: string, e: MouseEvent) => void;
  class?: string;
};

export function ParentMessage(props: ParentMessageProps) {
  const ctx = useStandaloneThread();

  return (
    <Show when={ctx.parent()}>
      {(parentMsg) => (
        <Message.Root
          message={parentMsg()}
          actions={props.actions}
          onClick={
            props.onClickMessage
              ? (e: MouseEvent) => props.onClickMessage!(parentMsg().id, e)
              : undefined
          }
          class={props.class}
        >
          <Message.Layout class="pt-(--regular-message-padding-t)">
            <Message.Slot placement="icon">
              <Message.SenderIcon />
            </Message.Slot>
            <Message.Slot
              placement="header"
              class="flex items-center gap-1 min-w-0"
            >
              <Message.SenderName />
              <Message.AgentBadge />
              <Message.EditedIndicator />
              <Message.Timestamp
                class="ml-auto shrink-0"
                format="dateAndTime"
              />
            </Message.Slot>
            <Message.Slot placement="content">
              <Message.Content />
            </Message.Slot>
            <Message.Slot placement="footer" class="flex flex-col min-w-0">
              <Message.Attachments />
              <Message.Reactions />
            </Message.Slot>
          </Message.Layout>
          <Show when={props.actions}>
            <Message.ActionMenu />
          </Show>
        </Message.Root>
      )}
    </Show>
  );
}

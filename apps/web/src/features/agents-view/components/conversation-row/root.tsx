import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { pressHandlers, Tooltip } from '@ui';
import { ConversationRowContext, type ConversationRowProps } from './context';

export function ConversationRowRoot(props: ConversationRowProps) {
  const description = () => {
    const labels: string[] = [];
    if (props.failed) labels.push(t('agentWork.rowFailed'));
    else if (props.state === 'working' || props.state === 'starting')
      labels.push(t('agentWork.rowWorking'));
    else if (props.state === 'waiting') labels.push(t('agentWork.rowWaiting'));
    if (props.unread) labels.push(t('agentWork.rowUnread'));
    return labels.join(', ');
  };

  return (
    <ConversationRowContext.Provider value={props}>
      <ViewSidebar.Item
        as="div"
        active={props.active}
        class="group/conversation relative text-ink [--conversation-row-surface:var(--color-hover)] aria-[current=page]:[--conversation-row-surface:var(--color-active)] not-aria-[current=page]:focus-within:bg-hover"
        data-agent-session-row={props.id}
        data-kind={props.kind}
        data-session-state={props.state}
      >
        <Tooltip.Root placement="right">
          <Tooltip.Trigger
            as="button"
            type="button"
            class="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={props.title}
            aria-description={description()}
            aria-current={props.active ? 'page' : undefined}
            {...pressHandlers((event) => props.onOpen?.(event))}
          />
          <Tooltip.Portal>
            <Tooltip.Content>{props.title}</Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        {props.children}
      </ViewSidebar.Item>
    </ConversationRowContext.Provider>
  );
}

import Tray from '@phosphor-icons/core/regular/tray.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ListInboxesItem = NamedTool<
  'ListInboxes',
  'response'
>['data']['inboxes'][number];

const inboxLabel = (inbox: ListInboxesItem): string => {
  if (inbox.isPrimary) return 'Primary';
  if (inbox.isDelegated) return 'Delegated';
  return 'Connected';
};

const ListInboxesToolResponse = (props: { inboxes: ListInboxesItem[] }) => (
  <Tool.List>
    <For each={props.inboxes}>
      {(inbox) => (
        <Tool.ListItem icon={<Tray class="size-4" />}>
          <div class="flex min-w-0 items-center justify-between gap-2">
            <span class="truncate text-xs text-ink">{inbox.emailAddress}</span>
            <span class="shrink-0 text-xs text-ink-extra-muted">
              {inboxLabel(inbox)}
            </span>
          </div>
        </Tool.ListItem>
      )}
    </For>
  </Tool.List>
);

const handler = createToolRenderer({
  name: 'ListInboxes',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const inboxes = () => ctx.response?.data.inboxes ?? [];
    const hasResults = () => inboxes().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = inboxes().length;
      if (count === 0) return 'No inboxes';
      return count === 1 ? '1 inbox' : `${count} inboxes`;
    };

    return (
      <BaseTool
        icon={Tray}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListInboxesToolResponse inboxes={inboxes()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">List inboxes</span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const listInboxesHandler = handler;

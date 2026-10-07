import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useChannelName } from '@core/context/channels';
import BuildingsIcon from '@phosphor/buildings.svg';
import HashIcon from '@phosphor/hash.svg';
import { Button, cn } from '@ui';
import { type Component, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  PR_PRIORITY_LABELS,
  type PrLinks,
  priorityTaskName,
} from '../../data/pr-links';
import { prLinksTarget, usePrLinksQuery } from '../../queries/pr-links-query';
import { PrPriorityIcon } from '../PrLinks';

function LinkRow(props: {
  icon?: Component<{ class?: string }>;
  leading?: JSX.Element;
  content: SplitContent;
  children: JSX.Element;
  class?: string;
}) {
  const layout = useSplitLayout();
  return (
    <button
      type="button"
      class={cn(
        'flex h-6 w-full min-w-0 items-center gap-2 rounded text-left hover:text-ink',
        props.class
      )}
      onClick={(event) =>
        layout?.openWithSplit(props.content, {
          preferNewSplit: event.shiftKey,
        })
      }
    >
      <Show when={props.icon} fallback={props.leading}>
        {(icon) => {
          const Icon = icon();
          return <Icon class="size-3.5 shrink-0 text-ink-muted" />;
        }}
      </Show>
      <span class="min-w-0 truncate">{props.children}</span>
    </button>
  );
}

function ChannelRow(props: { id: string }) {
  const name = useChannelName(props.id, 'Channel');
  return (
    <LinkRow icon={HashIcon} content={{ type: 'channel', id: props.id }}>
      {name()}
    </LinkRow>
  );
}

function LinkGroup(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex flex-col gap-0.5">
      <div class="text-ink-placeholder">{props.label}</div>
      {props.children}
    </div>
  );
}

function priorityDetail(links: PrLinks) {
  const { priority } = links;
  if (priority.id === 'none') return 'Link a task with a priority to set one';
  if (priority.source === 'label') return 'From a GitHub label';
  const task = priorityTaskName(links);
  return task ? `From ${task}` : 'From a linked task';
}

/**
 * The tickets, customers, and channels a pull request links to, and the
 * priority they give it. Agent sessions have their own section.
 */
export function PrLinkedWorkSection(props: {
  pullRequest?: {
    owner: string;
    repo: string;
    number: number;
    labels?: readonly { name: string }[] | null;
  };
}) {
  const target = () =>
    props.pullRequest ? prLinksTarget(props.pullRequest) : undefined;
  const query = usePrLinksQuery(() => {
    const current = target();
    return current ? [current] : [];
  });
  const links = () => {
    const current = target();
    return current ? query.linksFor(current.url) : undefined;
  };

  return (
    <SidePanel.Section id="pr-linked-work" title="Linked work" order={25}>
      <Switch>
        <Match when={!props.pullRequest}>
          <div class="text-ink-placeholder" role="status">
            Loading pull request details…
          </div>
        </Match>
        <Match when={query.isError()}>
          <div class="text-ink-placeholder">Linked work couldn’t be loaded</div>
          <Button variant="ghost" size="xs" onClick={() => void query.retry()}>
            Retry
          </Button>
        </Match>
        <Match when={links()}>
          {(current) => (
            <div class="flex flex-col gap-3 text-xs">
              <LinkGroup label="Priority">
                <div class="flex h-6 items-center gap-2">
                  <PrPriorityIcon
                    priority={current().priority.id}
                    class="shrink-0"
                  />
                  <span class="text-ink">
                    {PR_PRIORITY_LABELS[current().priority.id]}
                  </span>
                </div>
                <div class="text-ink-placeholder">
                  {priorityDetail(current())}
                </div>
              </LinkGroup>
              <LinkGroup label="Tickets">
                <Show
                  when={current().tasks.length > 0}
                  fallback={
                    <div class="text-ink-placeholder">
                      Mention a task in the pull request to link it
                    </div>
                  }
                >
                  <For each={current().tasks}>
                    {(task) => (
                      <LinkRow
                        leading={
                          <PrPriorityIcon
                            priority={task.priority}
                            class="shrink-0"
                          />
                        }
                        content={{ type: 'md', id: task.id }}
                        class={cn(task.closed && 'text-ink-muted line-through')}
                      >
                        {task.name || 'Untitled task'}
                      </LinkRow>
                    )}
                  </For>
                </Show>
              </LinkGroup>
              <Show when={current().companyIds.length > 0}>
                <LinkGroup label="Customers">
                  <For each={current().companyIds}>
                    {(id) => (
                      <LinkRow
                        icon={BuildingsIcon}
                        content={{ type: 'company', id }}
                      >
                        {query.companyName(id) ?? 'Customer'}
                      </LinkRow>
                    )}
                  </For>
                </LinkGroup>
              </Show>
              <Show when={current().channelIds.length > 0}>
                <LinkGroup label="Channels">
                  <For each={current().channelIds}>
                    {(id) => <ChannelRow id={id} />}
                  </For>
                </LinkGroup>
              </Show>
            </div>
          )}
        </Match>
        <Match when={true}>
          <div class="text-ink-placeholder" role="status">
            Loading linked work…
          </div>
        </Match>
      </Switch>
    </SidePanel.Section>
  );
}

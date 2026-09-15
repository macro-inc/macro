import { getEntityClickContent } from '@channel/Attachments/attachment-utils';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { SidePanel } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, idToEmail, tryMacroId } from '@core/user';
import { Entity } from '@entity';
import ArrowRight from '@phosphor/arrow-right.svg';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { Button } from '@ui';
import { For, Show, Suspense } from 'solid-js';
import { useChannelRecentContent } from '../queries/shared-content';

export function ChannelSidePanel(props: {
  channelId: string;
  onTabChange: (tab: ChannelTabId) => void;
}) {
  return (
    <>
      <SidePanel.Section
        id="participants"
        title="Participants"
        defaultOpen
        order={10}
      >
        <Suspense fallback={<SectionLoading />}>
          <Participants
            channelId={props.channelId}
            onViewAll={() => props.onTabChange('participants')}
          />
        </Suspense>
      </SidePanel.Section>
      <SidePanel.Section id="files" title="Files" defaultOpen order={20}>
        <Suspense fallback={<SectionLoading />}>
          <RecentContent
            channelId={props.channelId}
            kind="files"
            onViewAll={() => props.onTabChange('files')}
          />
        </Suspense>
      </SidePanel.Section>
      <SidePanel.Section id="tasks" title="Tasks" defaultOpen order={30}>
        <Suspense fallback={<SectionLoading />}>
          <RecentContent
            channelId={props.channelId}
            kind="tasks"
            onViewAll={() => props.onTabChange('tasks')}
          />
        </Suspense>
      </SidePanel.Section>
    </>
  );
}

function SectionLoading() {
  return (
    <p class="px-3 py-4 text-xs text-ink-muted" role="status">
      Loading…
    </p>
  );
}

function Participants(props: { channelId: string; onViewAll: () => void }) {
  const query = useChannelParticipantsQuery(() => props.channelId);
  const participants = () => (query.isSuccess ? query.data : []);
  return (
    <div>
      <Show when={!query.isPending} fallback={<SectionLoading />}>
        <Show
          when={!query.isError}
          fallback={
            <p class="px-3 py-3 text-xs text-ink-muted">
              Could not load participants.{' '}
              <button class="underline" onClick={() => void query.refetch()}>
                Retry
              </button>
            </p>
          }
        >
          <div class="max-h-60 overflow-y-auto overscroll-contain">
            <For each={participants()}>
              {(participant) => (
                <div class="flex h-12 items-center gap-3 px-3">
                  <UserIcon id={participant.user_id} size="sm" showTooltip />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm text-ink">
                      {getDisplayName(tryMacroId(participant.user_id)) ||
                        idToEmail(participant.user_id)}
                    </div>
                    <div class="truncate text-xs text-ink-muted">
                      {idToEmail(participant.user_id)}
                    </div>
                  </div>
                  <Show when={participant.role !== 'member'}>
                    <span class="text-[10px] capitalize text-ink-muted">
                      {participant.role}
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <ViewAll
            label={`View all participants${participants().length ? ` · ${participants().length}` : ''}`}
            onClick={props.onViewAll}
          />
        </Show>
      </Show>
    </div>
  );
}

function RecentContent(props: {
  channelId: string;
  kind: 'files' | 'tasks';
  onViewAll: () => void;
}) {
  const { query, references } = useChannelRecentContent(
    () => props.channelId,
    props.kind
  );
  const { replaceOrInsertSplit } = useSplitLayout();
  const entities = () => (query.isSuccess ? query.data : []);
  return (
    <div>
      <Show
        when={!references.isPending && (!query.isPending || references.isError)}
        fallback={<SectionLoading />}
      >
        <Show
          when={!query.isError && !references.isError}
          fallback={
            <p class="px-3 py-3 text-xs text-ink-muted">
              Could not load {props.kind}.{' '}
              <button
                class="underline"
                onClick={() => {
                  void references.refetch();
                  void query.refetch();
                }}
              >
                Retry
              </button>
            </p>
          }
        >
          <For
            each={entities()}
            fallback={
              <p class="px-3 py-4 text-xs text-ink-muted">
                No {props.kind} shared yet.
              </p>
            }
          >
            {(entity) => (
              <Entity.Root
                entity={entity}
                onClick={() =>
                  replaceOrInsertSplit(getEntityClickContent(entity))
                }
                class="flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm hover:bg-hover"
              >
                <span class="size-4 shrink-0">
                  <Entity.Icon entity={entity} />
                </span>
                <span class="min-w-0 flex-1 truncate">
                  <Entity.Title entity={entity} />
                </span>
              </Entity.Root>
            )}
          </For>
        </Show>
      </Show>
      <ViewAll label={`View all ${props.kind}`} onClick={props.onViewAll} />
    </div>
  );
}

function ViewAll(props: { label: string; onClick: () => void }) {
  return (
    <div class="mt-1 border-t border-edge-muted px-1 pt-1">
      <Button
        variant="ghost"
        size="sm"
        class="w-full justify-between text-xs text-ink-muted"
        onClick={props.onClick}
      >
        {props.label}
        <ArrowRight class="size-3" />
      </Button>
    </div>
  );
}

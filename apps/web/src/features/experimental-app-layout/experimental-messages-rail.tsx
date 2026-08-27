import { openNewChannelModal } from '@channel/CreateChannelModal';
import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { Entity, type ChannelEntity, isChannelEntity } from '@entity';
import PlusIcon from '@phosphor/plus.svg';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

const RAIL_CHANNEL_LIMIT = 20;

function getChannelInitials(name: string): string {
  const words = name
    .replace(/^#+/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toLocaleUpperCase();
}

type ExperimentalMessagesRailProps = {
  selectedChannelId?: string;
  onSelect: (channel: ChannelEntity) => void;
};

/** Experimental Messages rail containing recently active channel and DM avatars. */
export function ExperimentalMessagesRail(props: ExperimentalMessagesRailProps) {
  const channelsQuery = useSoupAstItemsQuery(
    () => ({
      params: { limit: RAIL_CHANNEL_LIMIT, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: {
              channelImportance: true,
              channelIsParticipant: [true],
            },
          })
        )
      ),
    }),
    () => ({ staleTime: 30_000 })
  );

  const channels = createMemo(() =>
    (channelsQuery.data?.entities ?? []).filter(isChannelEntity)
  );

  return (
    <aside
      aria-label="Recent conversations"
      class="flex h-full shrink-0 flex-col items-start border-r border-edge-muted/60 py-3"
    >
      <div class="scrollbar-hidden flex min-h-0 w-full flex-1 flex-col items-start gap-1.5 overflow-y-auto px-4 @max-[720px]/experimental-soup:px-2">
        <Tooltip label="Create channel" placement="right">
          <button
            type="button"
            class="mb-1 flex size-10 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label="Create channel"
            onClick={() => openNewChannelModal()}
          >
            <span class="flex size-8 items-center justify-center rounded-full border border-dashed border-edge text-ink-muted">
              <PlusIcon class="size-4" />
            </span>
          </button>
        </Tooltip>
        <For each={channels()}>
          {(channel) => (
            <Tooltip label={channel.name} placement="right">
              <button
                type="button"
                class="relative flex size-10 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/40"
                aria-label={channel.name}
                aria-current={
                  props.selectedChannelId === channel.id ? 'page' : undefined
                }
                onClick={() => props.onSelect(channel)}
              >
                <Show when={props.selectedChannelId === channel.id}>
                  <span
                    aria-hidden="true"
                    class="absolute -left-4 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent @max-[720px]/experimental-soup:-left-2"
                  />
                </Show>
                <span class="relative flex size-8 items-center justify-center overflow-hidden rounded-full border border-edge bg-lift [&_img]:size-full [&_svg]:size-5">
                  <Show
                    when={channel.channelType !== 'direct_message'}
                    fallback={
                      <Entity.Icon
                        entity={channel}
                        suppressClick
                        showTooltip={false}
                      />
                    }
                  >
                    <span
                      aria-hidden="true"
                      class="absolute text-[26px] font-semibold leading-none text-ink/8"
                    >
                      #
                    </span>
                    <span class="relative text-[10px] font-semibold tracking-wide text-ink">
                      {getChannelInitials(channel.name)}
                    </span>
                  </Show>
                </span>
              </button>
            </Tooltip>
          )}
        </For>
      </div>
    </aside>
  );
}

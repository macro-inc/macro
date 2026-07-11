import { useChannelsContext } from '@core/context/channels';
import {
  Combobox,
  type ComboboxRootItemComponentProps,
} from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import HashIcon from '@phosphor/hash.svg';
import XIcon from '@phosphor/x.svg';
import { ChannelTypeEnum } from '@service-storage/client';
import { Surface } from '@ui';
import { type Component, createMemo, For, Show } from 'solid-js';

export type BotChannelOption = { id: string; name: string };

const ChannelItem: Component<
  ComboboxRootItemComponentProps<BotChannelOption>
> = (props) => (
  <Combobox.Item
    item={props.item}
    class="flex w-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink outline-none data-highlighted:bg-hover"
  >
    <HashIcon class="size-3.5 shrink-0 text-ink-muted" />
    <Combobox.ItemLabel class="min-w-0 flex-1 truncate">
      {props.item.rawValue.name}
    </Combobox.ItemLabel>
    <Combobox.ItemIndicator>
      <CheckIcon class="size-3.5 text-accent" />
    </Combobox.ItemIndicator>
  </Combobox.Item>
);

export function ChannelMultiSelect(props: {
  channelIds: string[];
  onChange: (channelIds: string[]) => void;
  disabled?: boolean;
}) {
  const channelsContext = useChannelsContext();
  const options = createMemo<BotChannelOption[]>(() =>
    channelsContext
      .channels()
      .filter((channel) => channel.channel_type === ChannelTypeEnum.Private)
      .map((channel) => ({
        id: channel.id,
        name: channel.name?.trim() || 'Unnamed channel',
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
  const selectedOptions = createMemo(() => {
    const selected = new Set(props.channelIds);
    return options().filter((channel) => selected.has(channel.id));
  });

  return (
    <Combobox<BotChannelOption>
      multiple
      options={options()}
      value={selectedOptions()}
      optionValue={(channel) => channel.id}
      optionLabel={(channel) => channel.name}
      optionTextValue={(channel) => channel.name}
      onChange={(channels) =>
        props.onChange(channels.map((channel) => channel.id))
      }
      placeholder="Search channels…"
      itemComponent={ChannelItem}
      placement="bottom-start"
      closeOnSelection={false}
      allowsEmptyCollection
      disabled={props.disabled}
    >
      <Combobox.Control<BotChannelOption>>
        {(state) => (
          <div class="flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-edge-muted px-2 py-1 focus-within:border-accent">
            <For each={state.selectedOptions()}>
              {(channel) => (
                <span class="flex min-w-0 max-w-full items-center gap-1 rounded-md bg-ink/[0.055] py-1 pr-1 pl-1.5 text-xs text-ink">
                  <HashIcon class="size-3 shrink-0 text-ink-muted" />
                  <span class="truncate">{channel.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${channel.name}`}
                    class="rounded p-0.5 text-ink-extra-muted hover:bg-hover hover:text-ink"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      state.remove(channel);
                    }}
                  >
                    <XIcon class="size-3" />
                  </button>
                </span>
              )}
            </For>
            <Combobox.Input class="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-ink-placeholder" />
            <Combobox.Trigger class="ml-auto rounded p-0.5 text-ink-extra-muted outline-none hover:bg-hover hover:text-ink">
              <CaretDownIcon class="size-3.5" />
            </Combobox.Trigger>
          </div>
        )}
      </Combobox.Control>
      <Combobox.Portal>
        <Combobox.Content
          as={Surface}
          depth={3}
          bgToken="menu"
          class="z-action-menu mt-1 w-[var(--kb-popper-anchor-width)] min-w-64 rounded-xl p-1.5 shadow-menu"
        >
          <Show
            when={options().length > 0}
            fallback={
              <div class="px-2 py-5 text-center text-xs text-ink-muted">
                No available channels
              </div>
            }
          >
            <Combobox.Listbox class="max-h-56 overflow-y-auto" />
          </Show>
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox>
  );
}

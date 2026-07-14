import { toast } from '@core/component/Toast/Toast';
import {
  Combobox,
  type ComboboxRootItemComponentProps,
} from '@kobalte/core/combobox';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { useBotsQuery } from '@queries/bots/bots';
import { useAddBotToChannelMutation } from '@queries/channel/channel-bots';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Surface } from '@ui';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  Show,
} from 'solid-js';
import { BotAvatar } from './BotAvatar';

const BotInviteItem: Component<ComboboxRootItemComponentProps<Bot>> = (
  props
) => (
  <Combobox.Item
    item={props.item}
    class="flex w-full cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-left text-ink outline-none data-highlighted:bg-hover"
  >
    <BotAvatar bot={props.item.rawValue} size="md" />
    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-baseline gap-1.5">
        <Combobox.ItemLabel class="truncate text-sm font-medium">
          {props.item.rawValue.name}
        </Combobox.ItemLabel>
        <span class="truncate text-xs text-ink-extra-muted">
          @{props.item.rawValue.handle}
        </span>
      </div>
      <Show when={props.item.rawValue.description}>
        {(description) => (
          <div class="mt-0.5 truncate text-xs text-ink-muted">
            {description()}
          </div>
        )}
      </Show>
    </div>
  </Combobox.Item>
);

export function BotInviteSelect(props: {
  channelId: string;
  channelBotIds: string[];
  focusRequest: number;
}) {
  const botsQuery = useBotsQuery();
  const addBotMutation = useAddBotToChannelMutation();
  const [selectedBot, setSelectedBot] = createSignal<Bot>();
  let inputRef: HTMLInputElement | undefined;

  const availableBots = createMemo(() => {
    const channelBotIds = new Set(props.channelBotIds);
    return (botsQuery.data ?? []).filter((bot) => !channelBotIds.has(bot.id));
  });

  const focusInput = () => {
    requestAnimationFrame(() => inputRef?.focus());
  };

  onMount(() => {
    if (props.focusRequest > 0) focusInput();
  });

  createEffect(
    on(
      () => props.focusRequest,
      (request) => {
        if (request > 0) focusInput();
      },
      { defer: true }
    )
  );

  const inviteBot = async () => {
    const bot = selectedBot();
    if (!bot) return;

    try {
      await addBotMutation.mutateAsync({
        channelId: props.channelId,
        botId: bot.id,
      });
      setSelectedBot(undefined);
      toast.success(`${bot.name} invited to channel`);
      focusInput();
    } catch {
      toast.failure('Failed to invite bot');
    }
  };

  return (
    <div class="flex flex-col gap-2 md:flex-row md:items-center">
      <div class="min-w-0 flex-1">
        <Combobox<Bot>
          multiple={false}
          options={availableBots()}
          value={selectedBot() ?? null}
          optionValue={(bot) => bot.id}
          optionLabel={(bot) => bot.name}
          optionTextValue={(bot) =>
            [bot.name, bot.handle, bot.description].filter(Boolean).join(' ')
          }
          onChange={(bot) => setSelectedBot(bot ?? undefined)}
          placeholder={
            botsQuery.isLoading ? 'Loading bots…' : 'Search existing bots…'
          }
          itemComponent={BotInviteItem}
          placement="bottom-start"
          allowsEmptyCollection
          disabled={botsQuery.isLoading || addBotMutation.isPending}
        >
          <Combobox.Control<Bot> class="block w-full">
            <div class="flex w-full items-center rounded-lg border border-edge-muted bg-surface px-3 py-2 text-sm text-ink outline-none focus-within:border-accent">
              <Combobox.Input
                ref={inputRef}
                class="min-h-7 min-w-0 flex-1 bg-transparent p-1 outline-none placeholder:text-ink-placeholder"
              />
              <Combobox.Trigger class="ml-2 rounded p-0.5 text-ink-extra-muted outline-none hover:bg-hover hover:text-ink">
                <CaretDownIcon class="size-3.5" />
              </Combobox.Trigger>
            </div>
          </Combobox.Control>
          <Combobox.Portal>
            <Combobox.Content
              as={Surface}
              depth={3}
              class="z-action-menu mt-1 w-[var(--kb-popper-anchor-width)] min-w-72 rounded-xl p-1.5 shadow-menu bg-menu"
            >
              <Show
                when={availableBots().length > 0}
                fallback={
                  <div class="px-3 py-5 text-center text-xs text-ink-muted">
                    No bots available to invite
                  </div>
                }
              >
                <Combobox.Listbox class="max-h-64 overflow-y-auto" />
              </Show>
            </Combobox.Content>
          </Combobox.Portal>
        </Combobox>
      </div>
      <button
        type="button"
        class="w-full shrink-0 rounded-xs bg-accent px-3 py-1.5 text-sm font-medium text-surface transition-colors hover:bg-accent/90 disabled:opacity-50 md:w-[127px]"
        disabled={!selectedBot() || addBotMutation.isPending}
        onClick={() => void inviteBot()}
      >
        {addBotMutation.isPending ? 'Inviting…' : 'Invite bot'}
      </button>
    </div>
  );
}

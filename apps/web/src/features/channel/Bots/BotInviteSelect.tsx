import { toast } from '@core/component/Toast/Toast';
import {
  Combobox,
  type ComboboxRootItemComponentProps,
} from '@kobalte/core/combobox';
import { useBotsQuery } from '@queries/bots/bots';
import { useAddBotToChannelMutation } from '@queries/channel/channel-bots';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { Button, inputClasses, Surface } from '@ui';
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
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-0 flex-1 basis-60">
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
            botsQuery.isLoading
              ? 'Loading bots…'
              : 'Search bots by name or handle'
          }
          itemComponent={BotInviteItem}
          placement="bottom-start"
          allowsEmptyCollection
          disabled={botsQuery.isLoading || addBotMutation.isPending}
        >
          <Combobox.Control<Bot> class="block w-full">
            <Combobox.Input
              ref={inputRef}
              aria-label="Search existing bots"
              class={inputClasses({
                size: 'lg',
                class: 'rounded-full px-4',
              })}
            />
          </Combobox.Control>
          <Combobox.Portal>
            <Combobox.Content
              as={Surface}
              depth={3}
              class="z-action-menu mt-1 w-[var(--kb-popper-anchor-width)] min-w-72 rounded-xl p-1.5 glass bg-menu-glass"
            >
              <Combobox.Listbox class="peer max-h-64 overflow-y-auto empty:hidden" />
              <div class="hidden px-3 py-5 text-center text-xs text-ink-muted peer-empty:block">
                {availableBots().length > 0
                  ? 'No matching bots'
                  : 'No bots available to invite'}
              </div>
            </Combobox.Content>
          </Combobox.Portal>
        </Combobox>
      </div>
      <Button
        variant="outline"
        disabled={!selectedBot() || addBotMutation.isPending}
        onClick={() => void inviteBot()}
      >
        {addBotMutation.isPending ? 'Inviting…' : 'Invite bot'}
      </Button>
    </div>
  );
}

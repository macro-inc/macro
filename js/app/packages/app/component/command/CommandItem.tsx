import { Hotkey } from '@core/component/Hotkey';
import { hasValidHotkey } from '@core/hotkey/utils';
import type { HotkeySequenceStep } from '@core/component/Tooltip';
import { For, Match, Show, Switch } from 'solid-js';
import {
  isCommandItem,
  isEntityItem,
  type CommandMenuItem,
} from './useCommandItems';
import { Entity, type EntityData } from '@entity';
import { cn } from '@ui/utils/classname';
import Terminal from '@phosphor-icons/core/regular/terminal.svg?component-solid';
import { Dynamic } from 'solid-js/web';

export interface CommandItemProps {
  item: CommandMenuItem;
  index: number;
  selected: boolean;
  onSelect: (item: CommandMenuItem, openInNewSplit: boolean) => void;
  onHover?: (index: number) => void;
}

function CommandItemHotkey(props: { item: CommandMenuItem }) {
  const commandItem = () => (isCommandItem(props.item) ? props.item : null);
  const command = () => commandItem()?.data ?? null;
  const token = () => command()?.hotkeyToken;
  const sequence = () => commandItem()?.displayHotkeySequence;

  const shortcut = () => {
    const item = commandItem();
    const cmd = item?.data;
    if (!cmd) return undefined;
    if (hasValidHotkey(token())) return undefined;
    return item?.displayHotkey ?? cmd.hotkeys?.[0];
  };

  const hasHotkey = () =>
    hasValidHotkey(token()) ||
    Boolean(shortcut()) ||
    Boolean(sequence()?.length);

  const StepHotkey = (step: HotkeySequenceStep) => (
    <div class="p-2 py-0.5 border border-edge-muted/50 rounded-xs">
      <Hotkey
        token={step.token}
        shortcut={step.shortcut}
        class="flex gap-1 items-center"
      />
    </div>
  );

  return (
    <Show when={hasHotkey()}>
      <div class="pr-2 flex items-center justify-center text-[0.75rem] font-medium text-ink-extra-muted">
        <Show
          when={sequence()?.length}
          fallback={
            <div class="p-2 py-0.5 border border-edge-muted/50 rounded-xs">
              <Hotkey
                token={token()}
                shortcut={shortcut()}
                class="flex gap-1 items-center"
              />
            </div>
          }
        >
          <div class="flex items-center gap-1">
            <For each={sequence()}>
              {(step, index) => (
                <>
                  {StepHotkey(step)}
                  <Show when={index() < (sequence()?.length ?? 0) - 1}>
                    <span class="text-ink-extra-muted">then</span>
                  </Show>
                </>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function CommandDisplay(props: { item: CommandMenuItem }) {
  const command = () => (isCommandItem(props.item) ? props.item.data : null);

  const description = () => {
    const cmd = command();
    if (!cmd) return '';
    return typeof cmd.description === 'function'
      ? cmd.description()
      : cmd.description;
  };

  return (
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <div class="size-5 flex items-center justify-center text-ink-muted shrink-0">
        <Show when={command()?.icon} fallback={<Terminal class="size-4" />}>
          {(icon) => <Dynamic component={icon()} class="size-4" />}
        </Show>
      </div>
      <span class="truncate text-ink">{description()}</span>
    </div>
  );
}

function EntityDisplay(props: { entity: EntityData }) {
  return (
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <div class="size-5 p-0.5 flex items-center justify-center text-ink-muted shrink-0">
        <Entity.Icon entity={props.entity} />
      </div>
      <Entity.Title entity={props.entity} />
    </div>
  );
}

function ItemDisplay(props: { item: CommandMenuItem }) {
  return (
    <Switch>
      <Match when={isCommandItem(props.item) && props.item}>
        {(item) => <CommandDisplay item={item()} />}
      </Match>
      <Match when={isEntityItem(props.item) && props.item}>
        {(item) => <EntityDisplay entity={item().data} />}
      </Match>
    </Switch>
  );
}

export function CommandItem(props: CommandItemProps) {
  return (
    <div
      class={cn(
        'group flex items-center h-10 px-2 text-sm font-semibold relative',
        {
          'bg-accent/5 outline-1 outline-accent/20 -outline-offset-1':
            props.selected,
          'hover:bg-hover/30': !props.selected,
        }
      )}
      onMouseMove={() => props.onHover?.(props.index)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onSelect(props.item, e.shiftKey);
      }}
    >
      {/* Accent bar indicator */}
      <div
        class={cn('absolute h-full w-[3px] left-0 top-0 bg-accent opacity-0', {
          'opacity-100': props.selected,
        })}
      />
      <ItemDisplay item={props.item} />
      <div class="ml-auto">
        <CommandItemHotkey item={props.item} />
      </div>
    </div>
  );
}

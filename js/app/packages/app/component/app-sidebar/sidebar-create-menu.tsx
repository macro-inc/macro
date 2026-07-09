import { useAnalytics } from '@app/component/analytics-context';
import { CREATABLE_BLOCKS } from '@app/component/Launcher';
import { CREATE_MENU_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { getIconConfig } from '@core/component/EntityIcon';
import {
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import { setActiveScope } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import PlusIcon from '@phosphor/plus.svg';
import { Button, cn, Dropdown, Hotkey, NavRow } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const SidebarCreateMenu = (props: {
  isSlim: () => boolean;
  variant?: 'row' | 'icon';
  onMenuOpenChange?: (open: boolean) => void;
}) => {
  const analytics = useAnalytics();
  const [open, setOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });

  const blocks = createMemo(() =>
    CREATABLE_BLOCKS.filter(
      (block) => block.blockName !== 'snippet' || snippetsFlag().enabled
    )
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open()) {
      analytics.track('create_menu_open', { from: 'sidebar' });
    }
    setOpen(nextOpen);
    props.onMenuOpenChange?.(nextOpen);
    if (nextOpen) {
      setActiveScope(CREATE_MENU_COMMAND_SCOPE);
    } else {
      activateClosestDOMScope();
    }
  };

  onCleanup(() => props.onMenuOpenChange?.(false));

  useHotkeyInterceptor((context) => {
    if (!open() || context.eventType !== 'keydown') return false;

    if (
      context.pressedKeysString === 'c' ||
      context.pressedKeysString === 'escape'
    ) {
      setOpen(false);
      activateClosestDOMScope();
      return true;
    }

    const matchingBlock = blocks().find((block) => {
      const shiftedHotkey = `shift+${block.hotkey}`;
      return (
        context.pressedKeysString === block.hotkey ||
        context.pressedKeysString === shiftedHotkey
      );
    });

    if (!matchingBlock) return false;

    setOpen(false);
    matchingBlock.keyDownHandler?.(context.event);
    activateClosestDOMScope();
    return true;
  });

  return (
    <Dropdown
      open={open()}
      onOpenChange={handleOpenChange}
      placement="right-start"
      gutter={8}
    >
      <Show
        when={props.variant === 'icon'}
        fallback={
          <Dropdown.Trigger
            as={NavRow}
            class="center h-8 bg-ink/4 text-[13px]"
            fullWidth
            tooltipPlacement="right"
            tooltipDisabled={!props.isSlim()}
            label="Create"
            hotkey={TOKENS.global.createCommand}
            onMouseDown={(e: MouseEvent) => {
              if (e.button !== 0) return;
              e.preventDefault();
            }}
          >
            <div class="size-4 shrink-0">
              <PlusIcon class="size-4" />
            </div>
            <span class="whitespace-nowrap group-data-[slim=true]/sidebar:hidden">
              Create
            </span>
            <Show when={open()}>
              <div class="text-xxs text-ink-extra-muted/50 rounded-sm ml-auto border border-ink/5 px-1.5 py-px -my-1 group-data-[slim=true]/sidebar:hidden">
                <Hotkey
                  token={TOKENS.global.createCommand}
                  class="flex gap-1"
                />
              </div>
            </Show>
          </Dropdown.Trigger>
        }
      >
        <Dropdown.Trigger
          as={Button}
          variant="ghost"
          class="rounded-md"
          size="icon-sm"
          label="Create"
          hotkey={TOKENS.global.createCommand}
          onMouseDown={(e: MouseEvent) => {
            if (e.button !== 0) return;
            e.preventDefault();
          }}
        >
          <PlusIcon class="size-3.5!" />
        </Dropdown.Trigger>
      </Show>
      <Dropdown.Content class="min-w-52 shadow-menu">
        <Dropdown.Group>
          <For each={blocks()}>
            {(block, index) => {
              const iconConfig = getIconConfig(block.blockName);

              return (
                <Dropdown.Item
                  class="min-h-9 gap-2 px-2.5"
                  onFocus={() => setFocusedIndex(index())}
                  onMouseEnter={() => setFocusedIndex(index())}
                  onSelect={() => {
                    setOpen(false);
                    block.keyDownHandler();
                  }}
                >
                  <div
                    class={cn(
                      'size-4 shrink-0 flex items-center rounded-sm [&_svg]:size-4',
                      iconConfig.foreground
                    )}
                  >
                    <Dynamic
                      component={block.animatedIcon ?? block.icon}
                      triggerAnimation={focusedIndex() === index()}
                    />
                  </div>
                  <span class="flex-1 text-ink">{block.label}</span>
                  <Hotkey
                    token={block.hotkeyToken}
                    theme="subtle"
                    class="ml-6"
                  />
                </Dropdown.Item>
              );
            }}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

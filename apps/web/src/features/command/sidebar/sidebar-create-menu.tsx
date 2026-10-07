import { CREATE_MENU_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  setCreateMenuOpen,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { setActiveScope } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import CreateIcon from '@phosphor/note-pencil.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, Hotkey, NavRow } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import {
  createSignal,
  For,
  onCleanup,
  Show,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createMenuVariant } from '../create-menu-variants/variant-state';
import { APP_TOUR } from './tour';

export type SidebarCreateMenuProps = {
  /** Only read by the built-in `row` variant, for its tooltip. */
  isSlim?: () => boolean;
  variant?: 'row' | 'icon';
  /**
   * Your own trigger, rendered as the Kobalte `Dropdown.Trigger` via `as` — so
   * the ref, aria wiring and open/close handlers are attached for you. Spread
   * the props you receive onto one interactive element, and style the open
   * state off the `data-expanded` attribute Kobalte sets on it.
   *
   * Takes precedence over `variant`.
   */
  trigger?: ValidComponent;
  onMenuOpenChange?: (open: boolean) => void;
};

/**
 * With an experimental create-menu variant chosen, the sidebar trigger opens
 * the centered launcher instead of its own dropdown, so both entry points
 * show the layout under test.
 */
export const SidebarCreateMenu = (props: SidebarCreateMenuProps) => (
  <Show
    when={createMenuVariant() === 'list'}
    fallback={<SidebarCreateLauncherTrigger {...props} />}
  >
    <SidebarCreateDropdown {...props} />
  </Show>
);

const SidebarCreateLauncherTrigger = (props: SidebarCreateMenuProps) => {
  const analytics = useAnalytics();
  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  const openLauncher = () => {
    analytics.track('create_menu_open', { from: 'sidebar' });
    setCreateMenuOpen(true);
  };

  return (
    <Show
      when={props.trigger}
      fallback={
        <Show
          when={props.variant === 'icon'}
          fallback={
            <NavRow
              ref={createMenuTarget}
              class="center h-8 bg-ink/4 text-[13px]"
              fullWidth
              tooltipPlacement="right"
              tooltipDisabled={!(props.isSlim?.() ?? false)}
              label="Create"
              hotkey={TOKENS.global.createCommand}
              onClick={openLauncher}
            >
              <div class="size-4 shrink-0">
                <PlusIcon class="size-4" />
              </div>
              <span class="whitespace-nowrap group-data-[slim=true]/sidebar:hidden">
                Create
              </span>
            </NavRow>
          }
        >
          <Button
            ref={createMenuTarget}
            variant="outline"
            size="icon-sm"
            depth={1}
            class="size-[26px] bg-surface shadow-md shadow-drop-shadow [&_svg]:size-4!"
            label="Create"
            hotkey={TOKENS.global.createCommand}
            onClick={openLauncher}
          >
            <CreateIcon />
          </Button>
        </Show>
      }
    >
      {(trigger) => (
        <Dynamic
          component={trigger()}
          ref={createMenuTarget}
          onClick={openLauncher}
        />
      )}
    </Show>
  );
};

const SidebarCreateDropdown = (props: SidebarCreateMenuProps) => {
  const analytics = useAnalytics();
  const [open, setOpen] = createSignal(false);
  const blocks = useCreateMenuBlocks();
  let selectedAction: (() => void) | undefined;

  const isSlim = () => props.isSlim?.() ?? false;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open()) {
      analytics.track('create_menu_open', { from: 'sidebar' });
    }
    setOpen(nextOpen);
    props.onMenuOpenChange?.(nextOpen);
    if (nextOpen) {
      selectedAction = undefined;
      setActiveScope(CREATE_MENU_COMMAND_SCOPE);
    } else {
      activateClosestDOMScope();
    }
  };

  onCleanup(() => props.onMenuOpenChange?.(false));

  useHotkeyInterceptor((context) => {
    if (!open() || context.eventType !== 'keydown') return false;

    if (
      (context.pressedKeysString === 'c' &&
        !blocks().some((block) => block.hotkey === 'c')) ||
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
    if (
      context.isEditableFocused &&
      matchingBlock.runWithInputFocused === false
    )
      return false;

    selectedAction = () => matchingBlock.keyDownHandler(context.event);
    setOpen(false);
    activateClosestDOMScope();
    return true;
  });

  const createMenuTarget = tourTarget(APP_TOUR.createMenu);
  return (
    <Dropdown
      open={open()}
      onOpenChange={handleOpenChange}
      placement="right-start"
      gutter={8}
    >
      <Show
        when={props.trigger}
        fallback={
          <Show
            when={props.variant === 'icon'}
            fallback={
              <Dropdown.Trigger
                ref={createMenuTarget}
                as={NavRow}
                class="center h-8 bg-ink/4 text-[13px]"
                fullWidth
                tooltipPlacement="right"
                tooltipDisabled={!isSlim()}
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
              ref={createMenuTarget}
              as={Button}
              variant="outline"
              size="icon-sm"
              depth={1}
              class="size-[26px] bg-surface shadow-md shadow-drop-shadow [&_svg]:size-4!"
              label="Create"
              hotkey={TOKENS.global.createCommand}
              onMouseDown={(e: MouseEvent) => {
                if (e.button !== 0) return;
                e.preventDefault();
              }}
            >
              <CreateIcon />
            </Dropdown.Trigger>
          </Show>
        }
      >
        {(trigger) => (
          <Dropdown.Trigger
            ref={createMenuTarget}
            as={trigger()}
            // `Dropdown.Trigger` hardcodes `variant`/`size` for its default
            // `as={Button}` and spreads props after them, so both leak into a
            // custom trigger — and land on its element as junk attributes if it
            // is a plain `<button>`. Blank them for callers' own elements.
            variant={undefined}
            size={undefined}
          />
        )}
      </Show>

      <Dropdown.Content
        class="min-w-52"
        onCloseAutoFocus={(event) => {
          if (!selectedAction) return;
          event.preventDefault();
          // Finish the menu's focus restoration before opening the composer.
          queueMicrotask(selectedAction);
          selectedAction = undefined;
        }}
      >
        <Dropdown.Group>
          <For each={blocks()}>
            {(block) => (
              <Dropdown.Item
                class="min-h-9 gap-2 px-2.5"
                onSelect={() => {
                  selectedAction = () => block.keyDownHandler();
                  setOpen(false);
                }}
              >
                <div class="size-4 shrink-0 flex items-center rounded-sm text-ink-muted [&_svg]:size-4">
                  <Dynamic component={block.icon} />
                </div>
                <span class="flex-1 text-ink">{block.label}</span>
                <Hotkey token={block.hotkeyToken} theme="subtle" class="ml-6" />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};

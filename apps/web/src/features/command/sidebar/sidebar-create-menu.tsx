import { CREATE_MENU_COMMAND_SCOPE } from '@app/constants/hotkeys';
import {
  type CreatableBlock,
  useCreateMenuBlocks,
} from '@app/features/command/Launcher';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { setActiveScope } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import CreateIcon from '@icon/square-pen-create.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Button, Dropdown, Hotkey, NavRow } from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  onCleanup,
  Show,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * The create menu's behaviour with no opinion about how it looks: open state,
 * analytics, the command hotkey scope, and the type-a-letter-to-create
 * interceptor.
 *
 * Exported so a surface can own its own `Dropdown` (or another popover
 * entirely) and still get the real menu semantics — see
 * {@link CreateMenuContent}. Callers that only want a different button should
 * pass `trigger` to {@link SidebarCreateMenu} instead.
 */
export type CreateMenuController = {
  open: Accessor<boolean>;
  /** Closes (or opens) without re-running open-change side effects. */
  setOpen: (open: boolean) => void;
  /** Wire to the popover's `onOpenChange`. */
  handleOpenChange: (open: boolean) => void;
  blocks: Accessor<CreatableBlock[]>;
  focusedIndex: Accessor<number>;
  setFocusedIndex: (index: number) => void;
};

export function useCreateMenuController(
  props: {
    onMenuOpenChange?: (open: boolean) => void;
    /** `create_menu_open` attribution. Defaults to `'sidebar'`. */
    from?: string;
  } = {}
): CreateMenuController {
  const analytics = useAnalytics();
  const [open, setOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const blocks = useCreateMenuBlocks();

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !open()) {
      analytics.track('create_menu_open', { from: props.from ?? 'sidebar' });
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

  return {
    open,
    setOpen,
    handleOpenChange,
    blocks,
    focusedIndex,
    setFocusedIndex,
  };
}

/**
 * The creatable rows on their own, for a caller supplying its own
 * `Dropdown.Content`. Most callers want {@link CreateMenuContent}.
 */
export const CreateMenuItems = (props: {
  controller: CreateMenuController;
}) => (
  <For each={props.controller.blocks()}>
    {(block, index) => (
      <Dropdown.Item
        class="min-h-9 gap-2 px-2.5"
        onFocus={() => props.controller.setFocusedIndex(index())}
        onMouseEnter={() => props.controller.setFocusedIndex(index())}
        onSelect={() => {
          props.controller.setOpen(false);
          block.keyDownHandler();
        }}
      >
        <div class="size-4 shrink-0 flex items-center rounded-sm text-ink-muted [&_svg]:size-4">
          <Dynamic
            component={block.animatedIcon ?? block.icon}
            triggerAnimation={props.controller.focusedIndex() === index()}
          />
        </div>
        <span class="flex-1 text-ink">{block.label}</span>
        <Hotkey token={block.hotkeyToken} theme="subtle" class="ml-6" />
      </Dropdown.Item>
    )}
  </For>
);

/**
 * The menu body — everything below the trigger. Pair with
 * {@link useCreateMenuController} to build a create menu around any trigger,
 * without going through {@link SidebarCreateMenu} at all.
 *
 * @example
 * const controller = useCreateMenuController();
 * <Dropdown open={controller.open()} onOpenChange={controller.handleOpenChange}>
 *   <Dropdown.Trigger as={MyButton} />
 *   <CreateMenuContent controller={controller} />
 * </Dropdown>
 */
export const CreateMenuContent = (props: {
  controller: CreateMenuController;
  class?: string;
}) => (
  <Dropdown.Content class={props.class ?? 'min-w-52 shadow-menu'}>
    <Dropdown.Group>
      <CreateMenuItems controller={props.controller} />
    </Dropdown.Group>
  </Dropdown.Content>
);

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

export const SidebarCreateMenu = (props: SidebarCreateMenuProps) => {
  const controller = useCreateMenuController({
    onMenuOpenChange: (open) => props.onMenuOpenChange?.(open),
  });

  const isSlim = () => props.isSlim?.() ?? false;

  return (
    <Dropdown
      open={controller.open()}
      onOpenChange={controller.handleOpenChange}
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
                <Show when={controller.open()}>
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
              variant="outline"
              size="icon-sm"
              depth={1}
              class="size-[26px] rounded-full bg-surface shadow-md shadow-drop-shadow [&_svg]:size-4!"
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
            as={trigger()}
            // `Dropdown.Trigger` hardcodes `variant`/`size` for its default
            // `as={Button}` and spreads props after them, so both leak into a
            // custom trigger — and `variant` collides with the one
            // `SidebarItemNext` defines. Blank them for callers' own elements.
            variant={undefined}
            size={undefined}
          />
        )}
      </Show>

      <CreateMenuContent controller={controller} />
    </Dropdown>
  );
};

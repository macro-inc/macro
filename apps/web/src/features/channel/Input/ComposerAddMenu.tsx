import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { focusInput } from '@core/directive/focusInput';
import { isMobile } from '@core/mobile/isMobile';
import PlusIcon from '@phosphor/plus.svg';
import { Button, cn, Dropdown } from '@ui';
import { For, type JSX, Show } from 'solid-js';

export type ComposerAddMenuItem = {
  id: string;
  label: string;
  description?: string;
  icon: JSX.Element;
  /** A typed shortcut that does the same thing, e.g. `@`. */
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  /**
   * The item puts the caret in the editor (a mention, an inserted card), so
   * the editor takes focus as the menu closes instead of the +.
   */
  focusesEditor?: boolean;
};

export type ComposerAddMenuGroup = {
  /** Heads the group in the desktop menu. */
  label?: string;
  items: ComposerAddMenuItem[];
};

const nonEmpty = (groups: ComposerAddMenuGroup[]) =>
  groups.filter((group) => group.items.length > 0);

/**
 * The composer's +: everything that can go into a message. A menu on desktop;
 * on mobile it opens the composer's `ComposerAddDrawer`.
 */
export function ComposerAddMenu(props: {
  groups: ComposerAddMenuGroup[];
  onOpenDrawer: () => void;
  class?: string;
  contentClass?: string;
  placement?: 'top-start' | 'bottom-start';
  disabled?: boolean;
}) {
  return (
    <Show
      when={isMobile()}
      fallback={
        <AddDropdown
          groups={nonEmpty(props.groups)}
          class={props.class}
          contentClass={props.contentClass}
          placement={props.placement}
          disabled={props.disabled}
        />
      }
    >
      <Button
        variant="ghost"
        size="icon-composer"
        class={cn('touch:size-6', props.class)}
        aria-label="Add"
        aria-haspopup="dialog"
        disabled={props.disabled}
        // Keep compatibility mouse focus from blurring the editor before the
        // tap's click; pointerdown stays uncancelled so WebKit emits it.
        onMouseDown={(event: MouseEvent) => {
          if (event.button === 0) event.preventDefault();
        }}
        onClick={() => props.onOpenDrawer()}
      >
        <PlusIcon />
      </Button>
    </Show>
  );
}

function AddDropdown(props: {
  groups: ComposerAddMenuGroup[];
  class?: string;
  contentClass?: string;
  placement?: 'top-start' | 'bottom-start';
  disabled?: boolean;
}) {
  // An item that moves focus into the editor runs once the menu has closed,
  // in place of the menu's return of focus to the +; otherwise that return
  // closes the mention typeahead the item just opened.
  let pending: (() => void) | undefined;
  const select = (item: ComposerAddMenuItem) => {
    if (item.focusesEditor) pending = item.onSelect;
    else item.onSelect();
  };

  return (
    <Dropdown placement={props.placement ?? 'top-start'} gutter={8}>
      <Dropdown.Trigger
        data-composer-menu-anchor
        variant="ghost"
        size="icon-composer"
        class={cn('touch:size-6', props.class)}
        aria-label="Add"
        label="Add"
        disabled={props.disabled}
      >
        <PlusIcon />
      </Dropdown.Trigger>
      <Dropdown.Content
        class={cn('min-w-56', props.contentClass)}
        onCloseAutoFocus={(event: Event) => {
          const run = pending;
          pending = undefined;
          if (!run) return;
          event.preventDefault();
          run();
        }}
      >
        <For each={props.groups}>
          {(group) => (
            <Dropdown.Group>
              <Show when={group.label}>
                <Dropdown.GroupLabel>{group.label}</Dropdown.GroupLabel>
              </Show>
              <For each={group.items}>
                {(item) => (
                  <Dropdown.Item
                    disabled={item.disabled}
                    onSelect={() => select(item)}
                    class={
                      item.description
                        ? 'min-h-10 h-auto py-2 gap-3'
                        : undefined
                    }
                  >
                    <span class="flex size-3.5 shrink-0 items-center justify-center text-ink-muted">
                      {item.icon}
                    </span>
                    <span class="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-3">
                      <span class="block truncate">{item.label}</span>
                      <Show when={item.description}>
                        <span class="block truncate text-sm text-ink-muted font-normal">
                          {item.description}
                        </span>
                      </Show>
                    </span>
                    <Show when={item.hint}>
                      <span class="shrink-0 pl-4 font-mono text-xs text-ink-extra-muted">
                        {item.hint}
                      </span>
                    </Show>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          )}
        </For>
      </Dropdown.Content>
    </Dropdown>
  );
}

/**
 * The mobile add menu. One per composer, mounted outside its collapsing parts:
 * opening it takes focus from the editor, which collapses the composer and
 * unmounts the + that opened it.
 */
export function ComposerAddDrawer(props: {
  groups: ComposerAddMenuGroup[];
  /** The editor element, focused within the tap so the iOS keyboard opens. */
  getEditor: () => HTMLElement | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  let selectedAction = false;
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      onFinalFocus={(event) => {
        if (selectedAction) event.preventDefault();
        selectedAction = false;
      }}
      preventScroll={false}
      preventScrollbarShift={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content aria-label="Add to message">
          <MobileDrawer.Handle />
          <MobileDrawer.ScrollBody class="gap-3">
            <For each={nonEmpty(props.groups)}>
              {(group) => (
                <div class="flex shrink-0 flex-col">
                  {/* Sections alone separate the groups on mobile. */}
                  <MobileDrawer.Section class="flex flex-col">
                    <For each={group.items}>
                      {(item) => (
                        <MobileDrawer.Item
                          disabled={item.disabled}
                          data-composer-add-item={item.id}
                          ref={(el) => {
                            if (item.focusesEditor)
                              focusInput(el, () => ({
                                getTarget: props.getEditor,
                              }));
                          }}
                          onClick={() => {
                            selectedAction = true;
                            item.onSelect();
                            props.onOpenChange(false);
                          }}
                        >
                          <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted [&_svg]:size-5">
                            {item.icon}
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block">{item.label}</span>
                            <Show when={item.description}>
                              <span class="block text-xs text-ink-muted font-normal">
                                {item.description}
                              </span>
                            </Show>
                          </span>
                        </MobileDrawer.Item>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </div>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

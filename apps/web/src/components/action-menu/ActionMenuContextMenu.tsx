import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretRight from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import {
  createSignal,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  type ValidComponent,
} from 'solid-js';
import {
  type ActionMenuSection,
  type ActionMenuState,
  useProvidedActionMenu,
} from './action-menu-context';

function ContextMenuEntries(props: { sections: ActionMenuSection[] }) {
  return (
    <For each={props.sections}>
      {(section, index) => (
        <>
          <Show when={index() > 0}>
            <MenuSeparator />
          </Show>
          <For each={section.entries}>
            {(entry) => (
              <Switch>
                <Match when={entry.kind === 'item' && entry}>
                  {(item) => (
                    <ContextMenu.Item
                      class={cn(
                        MENU_ITEM_CLASS,
                        '[&>svg]:size-4 [&>svg]:shrink-0'
                      )}
                      disabled={item().disabled()}
                      onSelect={() => item().onSelect()}
                    >
                      {item().content()}
                    </ContextMenu.Item>
                  )}
                </Match>
                <Match when={entry.kind === 'sub' && entry}>
                  {(sub) => (
                    <ContextMenu.Sub>
                      <ContextMenu.SubTrigger
                        class={cn(
                          MENU_ITEM_CLASS,
                          '[&>svg]:size-4 [&>svg]:shrink-0'
                        )}
                      >
                        {sub().label()}
                        <CaretRight class="size-4 shrink-0" />
                      </ContextMenu.SubTrigger>
                      <ContextMenuContent submenu class="w-64">
                        <ContextMenuEntries sections={sub().sections()} />
                      </ContextMenuContent>
                    </ContextMenu.Sub>
                  )}
                </Match>
              </Switch>
            )}
          </For>
        </>
      )}
    </For>
  );
}

export type ActionMenuContextMenuProps = {
  /** Another Root's menu to render instead of the enclosing one. */
  menu?: ActionMenuState;
  /** What the user right-clicks. */
  trigger: JSX.Element;
  as?: ValidComponent;
  triggerClass?: string;
  contentClass?: string;
  onOpenChange?: (open: boolean) => void;
  /** Items that exist only while the menu is open. */
  children?: JSX.Element;
};

/** Right-click menu around `trigger`. Touch hosts bring their own long-press. */
export function ActionMenuContextMenu(props: ActionMenuContextMenuProps) {
  const menu = useProvidedActionMenu(() => props.menu);
  // Kobalte owns the open state; this mirror only gates the lazy children.
  const [open, setOpen] = createSignal(false);
  const handleOpenChange = (value: boolean) => {
    setOpen(value);
    props.onOpenChange?.(value);
  };

  return (
    <ContextMenu onOpenChange={handleOpenChange}>
      <ContextMenu.Trigger
        as={props.as ?? 'div'}
        class={cn('contents', props.triggerClass)}
      >
        {props.trigger}
      </ContextMenu.Trigger>
      <Show when={open()}>{props.children}</Show>
      <ContextMenu.Portal>
        <ContextMenuContent class={cn('w-64', props.contentClass)}>
          <ContextMenuEntries sections={menu().sections()} />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

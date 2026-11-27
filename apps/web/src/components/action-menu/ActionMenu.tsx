import type { HotkeyToken } from '@core/hotkey/tokens';
import { getActiveCommandByToken } from '@core/hotkey/utils';
import { cn, Hotkey } from '@ui';
import {
  children,
  createMemo,
  createSignal,
  getOwner,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { ActionMenuButton } from './ActionMenuButton';
import { ActionMenuContextMenu } from './ActionMenuContextMenu';
import { ActionMenuDrawer } from './ActionMenuDrawer';
import {
  ActionMenuContext,
  type ActionMenuState,
  createActionMenuRegistry,
  renderOwned,
  sectionsOf,
  useActionMenu,
} from './action-menu-context';

export type ActionMenuRootProps = {
  /** Section keys in render order. Unlisted sections follow, as first registered. */
  sections?: readonly string[];
  children: JSX.Element | ((menu: ActionMenuState) => JSX.Element);
};

/** Owns the item registry and the open state for the menus below it. */
function Root(props: ActionMenuRootProps) {
  const registry = createActionMenuRegistry();
  const [open, setOpen] = createSignal(false);
  const sections = createMemo(() =>
    sectionsOf(registry.entries, props.sections)
  );
  const menu: ActionMenuState = { ...registry, sections, open, setOpen };

  // Resolved inside the provider so items declared here find this menu.
  const content = () => {
    const child = props.children;
    return typeof child === 'function' ? child(menu) : child;
  };

  return (
    <ActionMenuContext.Provider value={menu}>
      {content()}
    </ActionMenuContext.Provider>
  );
}

export type ActionMenuItemProps = {
  /** Fixed at mount. Remount the item to move it. */
  section?: string;
  disabled?: boolean;
  onSelect: (event?: Event) => void;
  /** Row content. Rendered once per menu, so keep it plain markup. */
  children: JSX.Element;
};

/** Registers an item with the nearest Root or Sub and renders nothing in place. */
function Item(props: ActionMenuItemProps) {
  const menu = useActionMenu();
  const owner = getOwner();

  const unregister = menu.register({
    kind: 'item',
    section: props.section,
    disabled: () => props.disabled ?? false,
    onSelect: (event) => props.onSelect(event),
    content: () => renderOwned(owner, () => props.children),
  });
  onCleanup(unregister);

  return null;
}

/** Evaluates children for their registrations and renders nothing. */
function Collect(props: { children: JSX.Element }) {
  children(() => props.children);
  return null;
}

export type ActionMenuSubProps = {
  section?: string;
  /** Row content plus the nested items. Items render nothing, so what remains is the row. */
  children: JSX.Element;
};

/** A submenu. Items among its children register here instead of the parent; hidden while empty. */
function Sub(props: ActionMenuSubProps) {
  const parent = useActionMenu();
  const nested = createActionMenuRegistry();
  const sections = createMemo(() => sectionsOf(nested.entries));
  const owner = getOwner();
  const menu: ActionMenuState = {
    ...nested,
    sections,
    open: parent.open,
    setOpen: parent.setOpen,
  };
  // Menus re-create the row from the same children; items met on that pass register nowhere.
  const inert: ActionMenuState = { ...menu, register: () => () => {} };

  const unregister = parent.register({
    kind: 'sub',
    section: props.section,
    sections,
    label: () =>
      renderOwned(owner, () => (
        <ActionMenuContext.Provider value={inert}>
          {props.children}
        </ActionMenuContext.Provider>
      )),
  });
  onCleanup(unregister);

  return (
    <ActionMenuContext.Provider value={menu}>
      <Collect>{props.children}</Collect>
    </ActionMenuContext.Provider>
  );
}

/** Truncating text slot between the icon and the shortcut. */
function Label(props: { class?: string; children: JSX.Element }) {
  return (
    <span class={cn('flex-1 truncate', props.class)}>{props.children}</span>
  );
}

export type ActionMenuShortcutProps = {
  /** Shown only while the token's command is executable from here. */
  token?: HotkeyToken;
  /** Literal keys when there is no registered command. */
  hotkey?: string;
  class?: string;
};

/** Trailing hotkey hint. Hidden on touch devices. */
function Shortcut(props: ActionMenuShortcutProps) {
  const visible = () => {
    if (props.token) return getActiveCommandByToken(props.token) !== undefined;
    return props.hotkey !== undefined;
  };

  return (
    <Show when={visible()}>
      <Hotkey
        token={props.token}
        shortcut={props.hotkey}
        theme="subtle"
        showPlus
        class={cn('ml-auto shrink-0 touch:hidden', props.class)}
      />
    </Show>
  );
}

/*
<ActionMenu.Root sections={['file', 'delete']}>
  <ActionMenu label="File actions" />          // dots button; dropdown or sheet
  <ActionMenu.Item section="file" onSelect={print}>
    <PrinterIcon /> <ActionMenu.Label>Print</ActionMenu.Label>
    <ActionMenu.Shortcut token={TOKENS.print} />
  </ActionMenu.Item>
  <ActionMenu.Sub section="file">
    <ExportIcon /> <ActionMenu.Label>Export</ActionMenu.Label>
    <ActionMenu.Item onSelect={exportPdf}>PDF</ActionMenu.Item>
  </ActionMenu.Sub>
</ActionMenu.Root>

Items register anywhere under Root; content is declared as children and
rendered by each menu. Custom menus read `useActionMenu().sections()`.
*/
export const ActionMenu = Object.assign(ActionMenuButton, {
  Root,
  Item,
  Sub,
  Label,
  Shortcut,
  Button: ActionMenuButton,
  Drawer: ActionMenuDrawer,
  ContextMenu: ActionMenuContextMenu,
});

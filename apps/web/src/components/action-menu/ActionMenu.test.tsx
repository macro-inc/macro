import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import {
  createContext,
  createSignal,
  For,
  type JSX,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionMenu } from './ActionMenu';
import {
  type ActionMenuState,
  createActionMenuRegistry,
  sectionsOf,
} from './action-menu-context';

// Exercise the real menus without initializing the app UI barrel.
vi.mock('@ui', async () => ({
  ...(await import('../ui/utils/classname')),
  ...(await import('../ui/utils/menuKeyboardNavigation')),
  ...(await import('../ui/components/Dropdown')),
  ...(await import('../ui/components/Layer')),
  ...(await import('../ui/components/Button')),
  ...(await import('../ui/components/Hotkey')),
}));
vi.mock('../ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@core/hotkey/utils', () => ({
  getActiveCommandByToken: vi.fn(() => undefined),
  getPrettyHotkeyStringByToken: () => 'cmd+p',
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function renderMenu(
  children: (state: ActionMenuState) => JSX.Element,
  sections?: readonly string[]
) {
  let state!: ActionMenuState;
  render(() => (
    <ActionMenu.Root sections={sections}>
      {(menu) => {
        state = menu;
        return children(menu);
      }}
    </ActionMenu.Root>
  ));
  return { state: () => state };
}

function selectItem(element: HTMLElement) {
  fireEvent(element, new MouseEvent('pointerup', { button: 0, bubbles: true }));
}

describe('sectionsOf', () => {
  const item = (section?: string) => ({
    kind: 'item' as const,
    section,
    disabled: () => false,
    onSelect: () => {},
    content: () => null,
  });

  it('orders listed sections first, then the rest as registered', () => {
    const root = createActionMenuRegistry();
    root.register(item('b'));
    root.register(item(undefined));
    root.register(item('c'));
    root.register(item('a'));

    expect(
      sectionsOf(root.entries, ['a', 'b']).map((section) => section.key)
    ).toEqual(['a', 'b', undefined, 'c']);
  });

  it('drops a sub until it has entries', () => {
    const root = createActionMenuRegistry();
    const nested = createActionMenuRegistry();
    root.register({
      kind: 'sub',
      section: 'a',
      label: () => null,
      sections: () => sectionsOf(nested.entries),
    });

    expect(sectionsOf(root.entries)).toHaveLength(0);
    const unregister = nested.register(item());
    expect(sectionsOf(root.entries)[0]?.entries).toHaveLength(1);
    unregister();
    expect(sectionsOf(root.entries)).toHaveLength(0);
  });
});

describe('ActionMenu', () => {
  it('groups items by the root order and closes after selecting one', async () => {
    const onPrint = vi.fn();
    const { state } = renderMenu(
      () => (
        <>
          <ActionMenu label="File actions" />
          <ActionMenu.Item section="delete" onSelect={() => {}}>
            Delete
          </ActionMenu.Item>
          <ActionMenu.Item section="file" onSelect={onPrint}>
            Print
          </ActionMenu.Item>
          <ActionMenu.Item onSelect={() => {}}>Unsorted</ActionMenu.Item>
        </>
      ),
      ['file', 'delete']
    );

    state().setOpen(true);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((element) => element.textContent)).toEqual([
      'Print',
      'Delete',
      'Unsorted',
    ]);
    expect(screen.getAllByRole('group')).toHaveLength(3);

    selectItem(items[0]!);
    expect(onPrint).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(state().open()).toBe(false));
  });

  it('adds and removes items as they mount', () => {
    const [show, setShow] = createSignal(false);
    const { state } = renderMenu(() => (
      <Show when={show()}>
        <ActionMenu.Item onSelect={() => {}}>Print</ActionMenu.Item>
      </Show>
    ));

    expect(state().sections()).toHaveLength(0);
    setShow(true);
    expect(state().sections()[0]?.entries).toHaveLength(1);
    setShow(false);
    expect(state().sections()).toHaveLength(0);
  });

  it('renders a submenu from nested items', async () => {
    const onCopy = vi.fn();
    const { state } = renderMenu(() => (
      <>
        <ActionMenu label="Actions" />
        <ActionMenu.Sub>
          Dispatch
          <ActionMenu.Item onSelect={onCopy}>Copy prompt</ActionMenu.Item>
        </ActionMenu.Sub>
      </>
    ));

    state().setOpen(true);
    const trigger = await screen.findByRole('menuitem', { name: 'Dispatch' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    selectItem(await screen.findByRole('menuitem', { name: 'Copy prompt' }));
    expect(onCopy).toHaveBeenCalledTimes(1);

    // Drawing the row re-evaluated the Sub's children without re-registering its item.
    const sub = state().sections()[0]?.entries[0];
    expect(sub?.kind === 'sub' && sub.sections()[0]?.entries).toHaveLength(1);
  });

  it('renders item content under the providers around the item', async () => {
    const Name = createContext('missing');
    function ContextName() {
      return <>{useContext(Name)}</>;
    }
    const { state } = renderMenu(() => (
      <>
        <ActionMenu label="Actions" />
        <Name.Provider value="Print">
          <ActionMenu.Item onSelect={() => {}}>
            <ContextName />
          </ActionMenu.Item>
        </Name.Provider>
      </>
    ));

    state().setOpen(true);
    expect(await screen.findByRole('menuitem', { name: 'Print' })).toBeTruthy();
  });

  it('mounts surface children only while it is open', async () => {
    const mounted = vi.fn();
    function Probe() {
      onMount(mounted);
      return <ActionMenu.Item onSelect={() => {}}>Rename</ActionMenu.Item>;
    }
    const { state } = renderMenu(() => (
      <ActionMenu.ContextMenu trigger={<div>Row</div>}>
        <Probe />
      </ActionMenu.ContextMenu>
    ));

    expect(mounted).not.toHaveBeenCalled();
    expect(state().sections()).toHaveLength(0);
    fireEvent.contextMenu(screen.getByText('Row'));
    expect(
      await screen.findByRole('menuitem', { name: 'Rename' })
    ).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('renders the drawer with a header and closes after selecting', async () => {
    const onPrint = vi.fn();
    const onOpenChange = vi.fn();
    renderMenu(() => (
      <>
        <ActionMenu.Item onSelect={onPrint}>Print</ActionMenu.Item>
        <ActionMenu.Drawer
          open
          onOpenChange={onOpenChange}
          header={<div>Header</div>}
        />
      </>
    ));

    expect(await screen.findByText('Header')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('exposes the sections to a custom surface', () => {
    render(() => (
      <ActionMenu.Root>
        {(menu) => (
          <>
            <ActionMenu.Item section="file" onSelect={() => {}}>
              Print
            </ActionMenu.Item>
            <ul>
              <For each={menu.sections()}>
                {(section) => (
                  <li>
                    {section.key}: {section.entries.length}
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </ActionMenu.Root>
    ));

    expect(screen.getByRole('listitem').textContent).toBe('file: 1');
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutineRow } from '../core/types';
import type { RoutineRowMenuActions } from './routine-row-menu';
import { RoutinesList } from './routines-list';

const device = vi.hoisted(() => ({
  tabs: true,
  setMobile: (_mobile: boolean): void => {},
  /** Rows with a long-press handler attached now. */
  pressable: 0,
}));
// The phone width is a signal: a phone turned sideways passes 640px.
vi.mock('@core/mobile/isMobile', async () => {
  const { createSignal } = await import('solid-js');
  const [mobile, setMobile] = createSignal(false);
  device.setMobile = setMobile;
  return { isMobile: mobile };
});
vi.mock('@components/app/tab-layout/open-in-new-tab', () => ({
  canOpenInNewTab: () => device.tabs,
}));
// Touch timing is covered by the directive; a test event stands in for it.
vi.mock('@core/directive/touchHandler', async () => {
  const { onCleanup } = await import('solid-js');
  return {
    touchHandler: (
      element: HTMLElement,
      options: () => { onLongPress?: () => void }
    ) => {
      const press = () => options().onLongPress?.();
      element.addEventListener('test-long-press', press);
      device.pressable++;
      onCleanup(() => {
        element.removeEventListener('test-long-press', press);
        device.pressable--;
      });
    },
  };
});
vi.mock('@entity', () => ({
  InlineEntity: (props: { entity: { name: string } }) => props.entity.name,
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
// Kobalte scrolls a menu's items into view; jsdom has no layout.
vi.stubGlobal('scrollTo', () => {});
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

function routine(
  id: string,
  name: string,
  extra: Partial<RoutineRow> = {}
): RoutineRow {
  return {
    id,
    name,
    createdAt: '',
    when: 'Weekdays at 9:00 AM',
    whenKind: 'schedule',
    does: 'Sum up my day',
    group: 'schedule',
    status: 'Active',
    enabled: true,
    editable: true,
    children: [],
    pausedByParent: false,
    ...extra,
  };
}

const briefing = routine('briefing', 'Morning briefing');
const paused = routine('paused', 'Weekly digest', {
  enabled: false,
  status: 'Paused',
});
const theirs = routine('theirs', 'Team standup', { editable: false });
const child = routine('child', 'Follow up with Acme');
const parent = routine('parent', 'Inbox triage', {
  group: 'activity',
  children: [child],
});

function menuActions(
  overrides: Partial<RoutineRowMenuActions> = {}
): RoutineRowMenuActions {
  return {
    onOpenInNewSplit: vi.fn(),
    canOpenInNewSplit: () => true,
    onOpenInNewTab: vi.fn(),
    onRun: vi.fn(),
    runPending: () => false,
    onDuplicate: vi.fn(),
    onKeep: vi.fn(),
    onCopyLink: vi.fn(),
    onCopyId: vi.fn(),
    onShare: vi.fn(),
    onDelete: vi.fn(),
    entity: (row) => ({
      id: row.id,
      type: 'routine',
      name: row.name,
      ownerId: 'me',
      status: { kind: 'unscheduled' },
    }),
    ...overrides,
  };
}

function setup(
  rows: RoutineRow[],
  /** Null where the host gives rows no menu. */
  menu: RoutineRowMenuActions | null = menuActions()
) {
  const props = {
    rows,
    loading: false,
    error: false,
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onToggle: vi.fn(),
    onRetry: vi.fn(),
    menu: menu ?? undefined,
  };
  render(() => <RoutinesList {...props} />);
  return props;
}

async function openMenu(name: string) {
  // Prevented: the browser's own menu stays closed.
  expect(
    fireEvent.contextMenu(screen.getByRole('button', { name }), {
      clientX: 20,
      clientY: 20,
    })
  ).toBe(false);
  await screen.findByRole('menu');
}

const entries = () =>
  screen
    .getAllByRole('menuitem')
    .map((item) => item.firstChild?.textContent ?? item.textContent);

function choose(name: string) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'Enter' });
}

beforeEach(() => {
  device.setMobile(false);
  device.tabs = true;
  device.pressable = 0;
});
afterEach(cleanup);

describe('routine row menu', () => {
  it('offers its owner every action, grouped like other row menus', async () => {
    const props = setup([briefing]);
    await openMenu('Morning briefing');
    expect(entries()).toEqual([
      'Open in new split',
      'Open in new tab',
      'Run now',
      'Turn off',
      'Duplicate',
      'Copy Link',
      'Copy ID',
      'Share',
      'Delete',
    ]);
    expect(screen.getAllByRole('separator')).toHaveLength(4);
    expect(
      screen.getByRole('menuitem', { name: 'Delete' }).className
    ).toContain('text-failure-ink');
    // Opening the menu doesn't open the routine.
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it.each([
    ['Open in new split', 'onOpenInNewSplit'],
    ['Open in new tab', 'onOpenInNewTab'],
    ['Run now', 'onRun'],
    ['Duplicate', 'onDuplicate'],
    ['Copy Link', 'onCopyLink'],
    ['Copy ID', 'onCopyId'],
    ['Share', 'onShare'],
    ['Delete', 'onDelete'],
  ] as const)('%s acts on the row it was opened from', async (label, key) => {
    const menu = menuActions();
    const props = setup([paused, briefing], menu);
    await openMenu('Morning briefing');
    choose(label);
    await waitFor(() => expect(menu[key]).toHaveBeenCalledWith(briefing));
    expect(menu[key]).toHaveBeenCalledOnce();
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it.each([
    ['Morning briefing', 'Turn off', briefing],
    ['Weekly digest', 'Turn on', paused],
  ] as const)(
    '%s: %s switches it like its switch',
    async (name, label, row) => {
      const props = setup([briefing, paused]);
      await openMenu(name);
      choose(label);
      await waitFor(() => expect(props.onToggle).toHaveBeenCalledWith(row));
    }
  );

  it('disables what cannot run now', async () => {
    setup(
      [briefing],
      menuActions({
        canOpenInNewSplit: () => false,
        runPending: (row) => row.id === briefing.id,
      })
    );
    await openMenu('Morning briefing');
    for (const label of ['Open in new split', 'Run now'])
      expect(
        screen
          .getByRole('menuitem', { name: label })
          .hasAttribute('data-disabled')
      ).toBe(true);
    expect(
      screen
        .getByRole('menuitem', { name: 'Turn off' })
        .hasAttribute('data-disabled')
    ).toBe(false);
  });

  it('disables Run now while a run starts, with the menu open', async () => {
    const [pending, setPending] = createSignal(false);
    setup([briefing], menuActions({ runPending: () => pending() }));
    await openMenu('Morning briefing');
    const runNow = screen.getByRole('menuitem', { name: 'Run now' });
    expect(runNow.hasAttribute('data-disabled')).toBe(false);
    setPending(true);
    expect(runNow.hasAttribute('data-disabled')).toBe(true);
    setPending(false);
    expect(runNow.hasAttribute('data-disabled')).toBe(false);
    // The same item throughout, so focus stays on it.
    expect(screen.getByRole('menuitem', { name: 'Run now' })).toBe(runNow);
  });

  it('disables Run now in the phone drawer while a run starts', async () => {
    device.setMobile(true);
    const [pending, setPending] = createSignal(false);
    setup([briefing], menuActions({ runPending: () => pending() }));
    fireEvent.contextMenu(
      screen.getByRole('button', { name: 'Morning briefing' })
    );
    await screen.findByRole('dialog', { name: 'Entity actions' });
    const runNow = screen.getByRole('button', { name: 'Run now' });
    expect(runNow).toHaveProperty('disabled', false);
    setPending(true);
    expect(runNow).toHaveProperty('disabled', true);
  });

  it('gives a routine someone else owns opening and links only', async () => {
    setup([theirs]);
    await openMenu('Team standup');
    expect(entries()).toEqual([
      'Open in new split',
      'Open in new tab',
      'Copy Link',
      'Copy ID',
    ]);
  });

  it('leaves out tabs and sharing where they are off', async () => {
    device.tabs = false;
    setup([briefing], menuActions({ onShare: undefined }));
    await openMenu('Morning briefing');
    expect(entries()).not.toContain('Open in new tab');
    expect(entries()).not.toContain('Share');
  });

  it('keeps a sub-routine as the owner’s own', async () => {
    const menu = menuActions();
    setup([parent], menu);
    fireEvent.click(
      screen.getByRole('button', { name: 'Show or hide 1 sub-routine' })
    );
    await openMenu('Follow up with Acme');
    expect(entries()).toContain('Keep as my routine');
    choose('Keep as my routine');
    await waitFor(() => expect(menu.onKeep).toHaveBeenCalledWith(child));
  });

  it('stays open while the list refreshes under it', async () => {
    const [rows, setRows] = createSignal([briefing, paused]);
    const menu = menuActions();
    render(() => (
      <RoutinesList
        rows={rows()}
        loading={false}
        error={false}
        onCreate={vi.fn()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
        onRetry={vi.fn()}
        menu={menu}
      />
    ));
    await openMenu('Morning briefing');
    const open = screen.getByRole('menu');
    const runNow = screen.getByRole('menuitem', { name: 'Run now' });
    runNow.focus();
    // A refetch makes new objects for the same routines.
    setRows([{ ...briefing }, { ...paused, name: 'Weekly summary' }]);
    // The open menu hides the rest of the page from the accessibility tree.
    await screen.findByRole('button', { name: 'Weekly summary', hidden: true });
    expect(screen.getByRole('menu')).toBe(open);
    // The item in focus stays, so arrow keys and Enter keep working.
    expect(screen.getByRole('menuitem', { name: 'Run now' })).toBe(runNow);
    expect(document.activeElement).toBe(runNow);
    choose('Run now');
    await waitFor(() =>
      expect(menu.onRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: briefing.id })
      )
    );
  });

  it('has no menu where the host gives none', () => {
    setup([briefing], null);
    expect(
      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Morning briefing' })
      )
    ).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the actions in a drawer on a long press on a phone', async () => {
    device.setMobile(true);
    const menu = menuActions();
    setup([briefing], menu);
    screen
      .getByRole('button', { name: 'Morning briefing' })
      .closest('[role="row"]')
      ?.parentElement?.parentElement?.dispatchEvent(
        new Event('test-long-press')
      );
    const drawer = await screen.findByRole('dialog', {
      name: 'Entity actions',
    });
    // A phone shows one pane, so nothing opens beside the list.
    expect(
      [...drawer.querySelectorAll('button')].map((item) => item.textContent)
    ).toEqual([
      'Run now',
      'Turn off',
      'Duplicate',
      'Copy Link',
      'Copy ID',
      'Share',
      'Delete',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(menu.onRun).toHaveBeenCalledWith(briefing));
  });

  it('takes the long press only while at phone width', async () => {
    device.setMobile(true);
    setup([briefing]);
    expect(device.pressable).toBe(1);
    // Turned sideways past the phone width: the context menu's own long press
    // takes over, and no handler is left to swallow the tap.
    device.setMobile(false);
    expect(device.pressable).toBe(0);
    // Upright again: the long press opens the drawer.
    device.setMobile(true);
    expect(device.pressable).toBe(1);
    screen
      .getByRole('button', { name: 'Morning briefing' })
      .closest('[role="row"]')
      ?.parentElement?.parentElement?.dispatchEvent(
        new Event('test-long-press')
      );
    await screen.findByRole('dialog', { name: 'Entity actions' });
    // Gone with the list: no handler outlives its row.
    cleanup();
    expect(device.pressable).toBe(0);
  });

  it('opens the drawer for a phone’s own context menu event', async () => {
    device.setMobile(true);
    setup([briefing]);
    expect(
      fireEvent.contextMenu(
        screen.getByRole('button', { name: 'Morning briefing' })
      )
    ).toBe(false);
    await screen.findByRole('dialog', { name: 'Entity actions' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

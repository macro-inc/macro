import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import type { EntityData } from '@entity';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { NotificationMuteMenu } from '@notifications/components/NotificationMuteMenu';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Component, createSignal, type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoupEntityActionDrawer } from './SoupEntityActionDrawer';
import { SoupEntityActionsMenu } from './SoupEntityActionsMenu';

type TestGroup = {
  id: string;
  items: {
    id: string;
    label: string;
    onClick: () => void;
    copy?: boolean;
    menuItem?: Component;
  }[];
};

const actions = vi.hoisted(() => ({
  groups: [] as TestGroup[],
  getGroups: undefined as (() => TestGroup[]) | undefined,
  context: undefined as
    | { viewedProjectId?: string; createActionNavigationHandler?: unknown }
    | undefined,
  options: undefined as
    | { markDoneDelegate?: () => MarkDoneDelegate | undefined }
    | undefined,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'channels', id: 'chat' }) },
  }),
}));
vi.mock('./createSoupEntityActions', () => ({
  createSoupEntityActions: (options?: typeof actions.options) => {
    actions.options = options;
    return {
      buildActionGroups: (
        _list: unknown,
        _entities: unknown,
        context: typeof actions.context
      ) => {
        actions.context = context;
        return actions.getGroups?.() ?? actions.groups;
      },
    };
  },
  viewedProjectIdFromContent: () => undefined,
}));
vi.mock('@core/component/ContextMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/component/ContextMenu')>()),
  MenuItem: (props: { text: string; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick}>
      {props.text}
    </button>
  ),
  MenuSeparator: () => <hr />,
}));

const group = (...labels: string[]): TestGroup => ({
  id: labels[0],
  items: labels.map((label) => ({ id: label, label, onClick: () => {} })),
});

const viewContext: EntityActionViewContext = {
  supportsMarkDone: false,
  supportsOpenInNewSplit: true,
  senderBucket: undefined,
};

const renderMenu = (
  extraItems?: () => JSX.Element,
  extraActions?: { id: string; label: string; onClick: () => void }[],
  entity?: EntityData
) =>
  render(() => (
    <SoupEntityActionsMenu
      entities={entity ? [entity] : []}
      list={{} as EntityActionListState}
      viewContext={viewContext}
      extraItems={extraItems?.()}
      extraActions={extraActions}
    />
  ));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  actions.groups = [group('Favorite'), group('Delete')];
  actions.options = undefined;
  actions.getGroups = undefined;
});

it('retains picker state when an optimistic update rebuilds menu actions', () => {
  const [revision, setRevision] = createSignal(0);
  const mount = vi.fn();
  const Picker = () => {
    mount();
    const [search, setSearch] = createSignal('');
    return (
      <input
        aria-label="Picker search"
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
    );
  };
  actions.getGroups = () => {
    revision();
    return [
      {
        id: 'edit',
        items: [
          {
            id: 'appearance',
            label: 'Change icon',
            menuItem: Picker,
            onClick() {},
          },
        ],
      },
    ];
  };
  renderMenu();
  const search = screen.getByRole('textbox', { name: 'Picker search' });
  fireEvent.input(search, { target: { value: 'star' } });
  setRevision(1);
  expect(screen.getByRole('textbox', { name: 'Picker search' })).toBe(search);
  expect(search).toHaveProperty('value', 'star');
  expect(mount).toHaveBeenCalledOnce();
});

describe('SoupEntityActionsMenu mark done', () => {
  it('completes rows through the list that owns them', () => {
    const delegate = {
      canComplete: () => true,
      prepare: () => undefined,
    } satisfies MarkDoneDelegate;
    render(() => (
      <SoupEntityActionsMenu
        entities={[]}
        list={{} as EntityActionListState}
        viewContext={viewContext}
        markDoneDelegate={() => delegate}
      />
    ));

    expect(actions.options?.markDoneDelegate?.()).toBe(delegate);
  });
});
describe('SoupEntityActionsMenu view context', () => {
  it("uses the host's folder when the split content doesn't name one", () => {
    const navigate = () => undefined;
    render(() => (
      <SoupEntityActionsMenu
        entities={[]}
        list={{} as EntityActionListState}
        viewContext={viewContext}
        viewedProjectId="folder-1"
        createActionNavigationHandler={navigate}
      />
    ));

    expect(actions.context?.viewedProjectId).toBe('folder-1');
    expect(actions.context?.createActionNavigationHandler).toBe(navigate);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SoupEntityActionsMenu separators', () => {
  it('separates action groups without trailing the last one', () => {
    const view = renderMenu();

    expect(view.container.querySelectorAll('hr')).toHaveLength(1);
  });

  it('omits the separator when a host\u2019s extra items render nothing', () => {
    const view = renderMenu(() => (
      <Show when={false}>
        <button type="button">Move to label</button>
      </Show>
    ));

    expect(view.container.querySelectorAll('hr')).toHaveLength(1);
    expect(view.container.textContent).toBe('FavoriteDelete');
  });

  it('separates extra items that do render', () => {
    actions.groups[1].id = 'delete';
    const view = renderMenu(() => (
      <Show when={true}>
        <button type="button">Move to label</button>
      </Show>
    ));

    expect(view.container.querySelectorAll('hr')).toHaveLength(2);
    expect(view.container.textContent).toBe('FavoriteMove to labelDelete');
  });

  it('groups typed host actions before Delete', () => {
    actions.groups = [group('Favorite'), group('Delete')];
    actions.groups[0].items[0].id = 'favorite';
    actions.groups[1].items[0].id = 'delete';
    const view = renderMenu(
      undefined,
      [{ id: 'ask-macro', label: 'Ask Macro', onClick: () => {} }],
      { type: 'channel', id: 'channel' } as EntityData
    );
    expect(view.container.textContent).toBe('FavoriteAsk MacroDelete');
  });

  it('places JSX contributions with Modify before State and Delete', () => {
    actions.groups = [group('Rename'), group('Mute'), group('Delete')];
    actions.groups[0].id = 'modify';
    actions.groups[1].id = 'state';
    actions.groups[2].id = 'delete';
    const view = renderMenu(() => <button type="button">Move to label</button>);
    expect(view.container.textContent).toBe('RenameMove to labelMuteDelete');
  });

  it('leads with extra items alone when the entity has no actions', () => {
    actions.groups = [];
    const view = renderMenu(() => <button type="button">Move to label</button>);

    expect(view.container.querySelectorAll('hr')).toHaveLength(0);
    expect(view.container.textContent).toBe('Move to label');
  });
});

it('keeps host renderers and callbacks when inserting actions before Delete', () => {
  const copy = vi.fn(() => false);
  const remove = vi.fn();
  actions.groups = [
    {
      id: 'copy',
      items: [
        { id: 'copy-link', label: 'Copy link', copy: true, onClick: copy },
      ],
    },
    {
      id: 'delete',
      items: [{ id: 'delete', label: 'Delete', onClick: remove }],
    },
  ];
  const view = render(() => (
    <SoupEntityActionsMenu
      entities={[]}
      list={{} as EntityActionListState}
      viewContext={viewContext}
      extraItems={<button type="button">Host action</button>}
      item={(props) => (
        <button type="button" data-testid="host-item" onClick={props.onClick}>
          {props.text}
        </button>
      )}
      copyItem={(props) => (
        <button type="button" data-testid="host-copy" onClick={props.onCopy}>
          {props.text}
        </button>
      )}
      separator={() => <hr data-testid="host-separator" />}
    />
  ));

  expect(view.container.textContent).toBe('Copy linkHost actionDelete');
  expect(screen.getAllByTestId('host-separator')).toHaveLength(2);
  fireEvent.click(screen.getByTestId('host-copy'));
  expect(copy).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByTestId('host-item'));
  expect(remove).toHaveBeenCalledOnce();
});

describe('shared notification mute choices', () => {
  it('opens the preset submenu in a dropdown and forwards its deadline', () => {
    const snooze = vi.fn();
    const mute = vi.fn();
    const view = render(() => (
      <DropdownMenu>
        <DropdownMenu.Trigger>Open actions</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <NotificationMuteMenu
            label="Mute notifications"
            unmuteLabel="Unmute notifications"
            muted={false}
            onMute={mute}
            onSnooze={snooze}
          />
        </DropdownMenu.Content>
      </DropdownMenu>
    ));
    fireEvent.keyDown(view.getByText('Open actions'), { key: 'Enter' });
    fireEvent.keyDown(
      view.getByRole('menuitem', { name: 'Mute notifications' }),
      { key: 'ArrowRight' }
    );
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: /For 30 minutes/ }),
      { key: 'Enter' }
    );
    expect(snooze).toHaveBeenCalledOnce();
    const deadline: Date = snooze.mock.calls[0][0];
    expect(
      Math.abs(deadline.getTime() - Date.now() - 30 * 60_000)
    ).toBeLessThan(1000);
    expect(mute).not.toHaveBeenCalled();
  });

  it('drills into presets on mobile and returns without muting until a choice is made', () => {
    const snooze = vi.fn();
    const mute = vi.fn();
    const close = vi.fn();
    render(() => (
      <SoupEntityActionDrawer
        entity={undefined}
        open
        onOpenChange={close}
        groups={[
          {
            items: [
              {
                id: 'mute',
                label: 'Mute notifications',
                onClick: () => {},
                muteMenu: {
                  label: 'Mute notifications',
                  unmuteLabel: 'Unmute notifications',
                  muted: false,
                  onMute: mute,
                  onSnooze: snooze,
                },
              },
            ],
          },
        ]}
      />
    ));
    fireEvent.click(screen.getByText('Mute notifications'));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Back'));
    expect(mute).not.toHaveBeenCalled();
    expect(snooze).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Mute notifications'));
    fireEvent.click(screen.getByText('For 30 minutes'));
    expect(snooze).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledExactlyOnceWith(false);
  });
});

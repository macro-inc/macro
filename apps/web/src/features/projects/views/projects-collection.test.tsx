import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import type { Property } from '@property/types';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { For, type JSX, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ProjectRow,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectAccess } from '../core/project';
import { createProjectCollection } from '../primitives/project-collection';
import { ProjectsCollection } from './projects-collection';

const toast = vi.hoisted(() => ({ success: vi.fn(), failure: vi.fn() }));
const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('@core/component/Toast/Toast', () => ({ toast }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => device.mobile }));
// Touch timing is covered by the directive; a test event stands in for it.
vi.mock('@core/directive/touchHandler', () => ({
  touchHandler: (
    element: HTMLElement,
    options: () => { onLongPress?: () => void }
  ) =>
    element.addEventListener('test-long-press', () =>
      options().onLongPress?.()
    ),
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
// The shell, list engine, and row cells have their own coverage; this suite
// exercises what a row's context menu does to the list.
vi.mock('@app/components/view-shell', () => ({
  ViewShell: {
    Header: (props: ParentProps) => props.children,
    Content: (props: ParentProps) => props.children,
  },
  SearchBar: () => null,
  ListSortDropdown: () => null,
  ListGroupDropdown: () => null,
  ListFilterDropdown: () => null,
  useViewControlHotkeys: () => {},
}));
vi.mock('@app/components/view-shell/SidebarCreateButton', () => ({
  SidebarCreateButton: () => null,
}));
vi.mock('@app/components/list/ListViewport', () => ({
  ListViewport: <T,>(props: {
    items: readonly T[];
    children: (item: T) => JSX.Element;
  }) => <For each={props.items}>{(item) => props.children(item)}</For>,
}));
vi.mock('@app/components/list', () => ({
  useListInteractions: () => ({
    selection: { set: vi.fn(), toggle: vi.fn(), clear: vi.fn() },
  }),
}));
vi.mock(
  '@app/features/tasks-view/components/task-list/TaskGroupHeader',
  () => ({ TaskGroupHeader: () => null })
);
vi.mock('@entity/EntitySelectionToolbarModal', () => ({
  EntitySelectionToolbarModal: () => null,
}));
vi.mock('@entity', () => ({
  InlineEntity: (props: { entity: { name: string } }) => props.entity.name,
}));
// Rows portal their property editors, as the real cells do.
vi.mock('../components/project-row', async () => {
  const { Portal } = await import('solid-js/web');
  return {
    ProjectListHeader: () => null,
    ProjectRow: (props: {
      rowId: string;
      row: ProjectRow;
      highlighted: boolean;
    }) => (
      <div role="row" id={props.rowId} data-highlighted={props.highlighted}>
        {props.row.project.name}
        <Portal>
          <button type="button">Edit {props.row.project.name}</button>
        </Portal>
      </div>
    ),
  };
});

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  device.mobile = false;
  vi.unstubAllGlobals();
  animationStyle.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function selectProperty(
  id: string,
  displayName: string,
  options: [string, string][],
  value: string[] | null = null
): Property {
  return {
    propertyId: `${id}-value`,
    propertyDefinitionId: id,
    displayName,
    isMultiSelect: false,
    owner: { scope: 'system' },
    createdAt: '',
    updatedAt: '',
    valueType: 'SELECT_STRING',
    value,
    options: options.map(([optionId, label], index) => ({
      id: optionId,
      value: { type: 'string', value: label },
      display_order: index,
      color: null,
      property_definition_id: id,
      created_at: '',
      updated_at: '',
    })),
  };
}

const statusOptions: [string, string][] = [
  [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED, 'Not Started'],
  [PROPERTY_OPTION_IDS.STATUS.COMPLETED, 'Completed'],
];
const status = selectProperty(
  SYSTEM_PROPERTY_IDS.STATUS,
  'Status',
  statusOptions
);
const priority = selectProperty(SYSTEM_PROPERTY_IDS.PRIORITY, 'Priority', [
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH, 'High'],
]);

function project(
  id: string,
  name: string,
  access: ProjectAccess | undefined,
  properties: Property[] = []
): ProjectRow {
  return {
    project: {
      id,
      name,
      descriptionSurfaceId: `${id}-description`,
      updatedAt: '',
      access,
    },
    properties,
  };
}

function commands() {
  return {
    createTask: vi.fn(async () => null),
    pending: () => false,
    create: vi.fn(),
    rename: vi.fn(async (_id: string, _name: string) => {}),
    setMembers: vi.fn(async () => {}),
    assignTasks: vi.fn(async () => []),
    delete: vi.fn(async (_id: string) => {}),
    deleteMany: vi.fn(async (_ids: readonly string[]): Promise<string[]> => []),
    saveProperty: vi.fn(async () => {}),
    saveProperties: vi.fn(async () => {}),
  } satisfies ReturnType<ProjectsContext['createCommands']>;
}

function setup(
  rows: readonly ProjectRow[],
  options: { canOpenInNewSplit?: boolean; properties?: Property[] } = {}
) {
  const service = commands();
  const unused = (): never => {
    throw new Error('Unused capability');
  };
  const context: ProjectsContext = {
    userId: () => 'viewer',
    createCollectionSource: () => ({
      rows: () => rows,
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
      loadingMore: () => false,
      loadMore: async () => {},
      refresh: async () => {},
    }),
    createProjectSource: unused,
    createReferencesSource: unused,
    createPropertyDefinitionsSource: () => ({
      properties: () => options.properties ?? [status, priority],
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => service,
  };
  const host = {
    onOpen: vi.fn(),
    onCopyLink: vi.fn(),
    onCopyId: vi.fn(),
    onShare: vi.fn(),
  };
  let collection!: ReturnType<typeof createProjectCollection>;
  const view = render(() => {
    collection = createProjectCollection({
      createSource: context.createCollectionSource,
      userId: context.userId,
      initialState: {
        search: '',
        status: '',
        priority: '',
        dueBefore: '',
        dueAfter: '',
        mine: false,
        sort: 'updated',
        groupBy: 'none',
        scrollOffset: 0,
        collapsedGroupIds: [],
      },
    });
    return (
      <ProjectsProvider context={context}>
        <ProjectsCollection
          {...host}
          onCreate={vi.fn()}
          scopeId="projects"
          isActive={() => true}
          collection={collection}
          canOpenInNewSplit={() => options.canOpenInNewSplit ?? true}
        />
      </ProjectsProvider>
    );
  });
  const rowKey = (id: string) => {
    const item = collection
      .items()
      .find((row) => row.kind === 'entity' && row.entity.id === id);
    if (!item) throw new Error(`No row for ${id}`);
    return item.id;
  };
  return { ...view, service, host, collection, rowKey };
}

async function openMenu(name: string) {
  expect(
    fireEvent.contextMenu(screen.getByText(name), { clientX: 20, clientY: 20 })
  ).toBe(false);
  await screen.findByRole('menu');
}

const entries = () =>
  screen
    .getAllByRole('menuitem')
    .map((item) => item.firstChild?.textContent ?? '');

function choose(name: string | RegExp) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'Enter' });
}

describe('project row context menu', () => {
  it('focuses the row and offers an owner every project action', async () => {
    const view = setup([project('launch', 'Launch', 'owner')]);
    await openMenu('Launch');
    expect(
      screen.getByText('Launch').closest<HTMLElement>('[role="row"]')?.dataset
        .highlighted
    ).toBe('true');
    expect(view.collection.list.focus.key()).toBe(view.rowKey('launch'));
    expect(entries()).toEqual([
      'Open in new split',
      'Rename',
      'Set status',
      'Set priority',
      'Copy Link',
      'Copy ID',
      'Share',
      'Delete',
    ]);
  });

  it('keeps view access to navigation and links', async () => {
    setup([project('launch', 'Launch', 'view')]);
    await openMenu('Launch');
    expect(entries()).toEqual([
      'Open in new split',
      'Copy Link',
      'Copy ID',
      'Share',
    ]);
  });

  it('hands navigation, links, and sharing to the host', async () => {
    const view = setup([project('launch', 'Launch', 'edit')]);
    for (const [entry, callback] of [
      ['Copy Link', view.host.onCopyLink],
      ['Copy ID', view.host.onCopyId],
      ['Share', view.host.onShare],
    ] as const) {
      await openMenu('Launch');
      choose(entry);
      await waitFor(() => expect(callback).toHaveBeenCalledWith('launch'));
    }
    await openMenu('Launch');
    choose(/Open in new split/);
    await waitFor(() =>
      expect(view.host.onOpen).toHaveBeenCalledWith('launch', {
        newSplit: true,
      })
    );
  });

  it('disables opening beside the list when no split fits', async () => {
    setup([project('launch', 'Launch', 'owner')], {
      canOpenInNewSplit: false,
    });
    await openMenu('Launch');
    expect(
      screen
        .getByRole('menuitem', { name: /Open in new split/ })
        .getAttribute('aria-disabled')
    ).toBe('true');
  });

  it('renames through a dialog that keeps a failed name for retry', async () => {
    const view = setup([project('launch', 'Launch', 'edit')]);
    view.service.rename.mockRejectedValueOnce(new Error('Name taken'));
    await openMenu('Launch');
    choose('Rename');
    const input = await screen.findByRole('textbox', { name: 'Name' });
    expect((input as HTMLInputElement).value).toBe('Launch');
    const save = screen.getByRole('button', { name: 'Save name' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.input(input, { target: { value: '  Launch v2 ' } });
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Could not rename project. Please try again.'
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    );
    expect(view.service.rename).toHaveBeenCalledTimes(2);
    expect(view.service.rename).toHaveBeenLastCalledWith('launch', 'Launch v2');
  });

  it('deletes a project after confirmation', async () => {
    const view = setup([project('launch', 'Launch', 'owner')]);
    await openMenu('Launch');
    choose('Delete');
    expect(await screen.findByText('Delete project?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() =>
      expect(screen.queryByText('Delete project?')).toBeNull()
    );
    expect(view.service.deleteMany).toHaveBeenCalledWith(['launch']);
    expect(toast.success).toHaveBeenCalledWith('Project deleted');
  });

  it('leaves right-clicks in a row’s portaled editors to them', () => {
    setup([project('launch', 'Launch', 'owner')]);
    expect(fireEvent.contextMenu(screen.getByText('Edit Launch'))).toBe(true);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('adds the property submenus once their definitions load', async () => {
    const view = setup(
      [
        project('launch', 'Launch', 'owner'),
        project('roadmap', 'Roadmap', 'owner'),
      ],
      { properties: [] }
    );
    view.collection.list.selection.select(view.rowKey('launch'));
    view.collection.list.selection.select(view.rowKey('roadmap'));
    await openMenu('Launch');
    expect(entries()).toEqual(['Delete']);
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('opens the same actions in a long-press drawer on mobile', async () => {
    device.mobile = true;
    const view = setup([project('launch', 'Launch', 'owner')]);
    screen
      .getByText('Launch')
      .closest('[role="row"]')
      ?.parentElement?.dispatchEvent(new Event('test-long-press'));
    expect(view.collection.list.focus.key()).toBe(view.rowKey('launch'));
    const drawer = await screen.findByRole('dialog', {
      name: 'Entity actions',
    });
    expect(
      [...drawer.querySelectorAll('button')].map((item) => item.textContent)
    ).toEqual([
      'Rename',
      'Status: Not Started',
      'Status: Completed',
      'Priority: High',
      'Copy Link',
      'Copy ID',
      'Share',
      'Delete',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy ID' }));
    await waitFor(() =>
      expect(view.host.onCopyId).toHaveBeenCalledWith('launch')
    );
  });

  it('acts on the selection and keeps failed deletions for retry', async () => {
    const launchStatus: Property = {
      ...selectProperty(SYSTEM_PROPERTY_IDS.STATUS, 'Status', statusOptions, [
        PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
      ]),
      propertyId: 'launch-status',
    };
    const view = setup([
      project('launch', 'Launch', 'owner', [launchStatus]),
      project('roadmap', 'Roadmap', 'owner'),
      project('hiring', 'Hiring', 'owner'),
    ]);
    view.collection.list.selection.select(view.rowKey('launch'));
    view.collection.list.selection.select(view.rowKey('roadmap'));

    await openMenu('Hiring');
    expect(entries()).toContain('Rename');

    await openMenu('Roadmap');
    expect(entries()).toEqual(['Set status', 'Set priority', 'Delete']);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Set status' }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('menuitem', { name: 'Completed' });
    choose('Completed');
    await waitFor(() =>
      expect(view.service.saveProperties).toHaveBeenCalledOnce()
    );
    const value = {
      valueType: 'SELECT_STRING',
      values: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
    };
    // A row's own value saves like its cell; a missing one uses the definition.
    expect(view.service.saveProperties).toHaveBeenCalledWith([
      { id: 'launch', property: launchStatus, value },
      { id: 'roadmap', property: status, value },
    ]);

    view.service.deleteMany.mockResolvedValueOnce(['roadmap']);
    await openMenu('Launch');
    choose('Delete');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Delete 2 projects' })
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Deleted 1 of 2. The rest could not be deleted.'
    );
    expect(screen.getByText('Delete project?')).toBeTruthy();
    expect(view.collection.list.selection.isKeySelected('launch')).toBe(false);
    expect(view.collection.list.selection.isKeySelected('roadmap')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    await waitFor(() =>
      expect(screen.queryByText('Delete project?')).toBeNull()
    );
    expect(view.service.deleteMany).toHaveBeenCalledTimes(2);
    expect(view.service.deleteMany).toHaveBeenLastCalledWith(['roadmap']);
  });
});

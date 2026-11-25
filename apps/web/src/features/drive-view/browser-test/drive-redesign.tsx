import '@fontsource-variable/inter';
import '@app/index.css';
import { CollectionPanes, ViewShell } from '@app/components/view-shell';
import { CreateContextProvider } from '@app/features/command/context/create-context';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  SplitRouter,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import {
  appRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  legacyContentRoute,
} from '@app/routes/routes';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import {
  type EntityData,
  type KnownFolder,
  KnownFoldersProvider,
} from '@entity';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider, DragDropSensors } from '@thisbeyond/solid-dnd';
import { ImperativeDialogHost } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { render } from 'solid-js/web';
import { type DriveHostActions, DriveProvider } from '../context/drive-context';
import {
  type DriveRedesignHostActions,
  DriveRedesignProvider,
} from '../context/drive-redesign-context';
import type {
  DriveFolderMetadata,
  DriveListItem,
  DriveListSource,
  DriveSidebarSource,
} from '../context/drive-source';
import {
  isDriveModifiedPreset,
  matchesDateRange,
  modifiedPresetRange,
  resolveCreatorOptionIds,
} from '../core/drive-filters';
import type { DriveTrashItem } from '../core/drive-trash';
import type { DriveState } from '../core/types';
import { createDriveInlineEdit } from '../primitives/drive-inline-edit';
import { createDriveInspector } from '../primitives/drive-inspector';
import { createDriveList } from '../primitives/drive-list';
import { createDriveState } from '../primitives/drive-state';
import { createDriveUndoManager } from '../primitives/drive-undo';
import { createDriveViewPreferences } from '../primitives/drive-view-preferences';
import type { DriveTrashSource } from '../queries/drive-trash';
import { DriveRedesignMobileWorkspace } from '../views/mobile/drive-redesign-mobile';
import { DriveRedesignColumns } from '../views/redesign/drive-redesign-columns';
import { DriveRedesignGrid } from '../views/redesign/drive-redesign-grid';
import { DriveRedesignHeader } from '../views/redesign/drive-redesign-header';
import { DriveRedesignInspector } from '../views/redesign/drive-redesign-inspector';
import { DriveRedesignList } from '../views/redesign/drive-redesign-list';
import { DriveRedesignStarred } from '../views/redesign/drive-redesign-starred';
import { DriveRedesignTrash } from '../views/redesign/drive-redesign-trash';
import { folderToProjectEntity } from '../views/shared/use-drive-display-items';

const params = new URLSearchParams(location.search);
const isMobileFixture = params.get('mobile') === '1';
if (isMobileFixture) {
  document.documentElement.dataset.touchDevice = 'true';
  document.documentElement.dataset.platform = 'ios';
}
if (params.get('theme') === 'dark') {
  document.documentElement.setAttribute('data-theme-light', 'false');
  document.documentElement.style.colorScheme = 'dark';
} else {
  document.documentElement.setAttribute('data-theme-light', 'true');
  document.documentElement.style.colorScheme = 'light';
}

const ALICE_ID = 'user-alice';
const BOB_ID = 'user-bob';

const NOW = new Date();
const minsAgo = (m: number) =>
  new Date(NOW.getTime() - m * 60_000).toISOString();

const INITIAL_FOLDERS: DriveFolderMetadata[] = [
  {
    id: 'folder-product',
    name: 'Product',
    parentId: null,
    userId: ALICE_ID,
    createdAt: minsAgo(240),
    updatedAt: minsAgo(15),
  },
  {
    id: 'folder-specs',
    name: 'Specs',
    parentId: 'folder-product',
    userId: ALICE_ID,
    createdAt: minsAgo(200),
    updatedAt: minsAgo(12),
  },
  {
    id: 'folder-q3',
    name: 'Q3 Launch',
    parentId: 'folder-specs',
    userId: ALICE_ID,
    createdAt: minsAgo(180),
    updatedAt: minsAgo(10),
  },
  {
    id: 'folder-design',
    name: 'Design Assets',
    parentId: 'folder-product',
    userId: ALICE_ID,
    createdAt: minsAgo(190),
    updatedAt: minsAgo(20),
  },
  {
    id: 'folder-engineering',
    name: 'Engineering',
    parentId: null,
    userId: ALICE_ID,
    createdAt: minsAgo(300),
    updatedAt: minsAgo(30),
  },
  {
    id: 'folder-archive',
    name: 'Quarterly Archive',
    parentId: null,
    userId: ALICE_ID,
    createdAt: minsAgo(500),
    updatedAt: minsAgo(45),
  },
  {
    id: 'folder-empty',
    name: 'New Initiatives',
    parentId: null,
    userId: ALICE_ID,
    createdAt: minsAgo(50),
    updatedAt: minsAgo(50),
  },
  {
    id: 'folder-partner',
    name: 'Partner Portal',
    parentId: null,
    userId: BOB_ID,
    createdAt: minsAgo(120),
    updatedAt: minsAgo(25),
  },
];

const LONG_FILENAME =
  'Quarterly Executive Business Review — Enterprise Expansion & Platform Architecture Notes (Final v4.2 Revised Edition).md';

function makeInitialDocs(): EntityData[] {
  const docs: EntityData[] = [
    {
      type: 'document',
      id: 'doc-plan',
      name: 'Q3 Operating Plan.md',
      fileType: 'md',
      ownerId: ALICE_ID,
      updatedAt: minsAgo(5),
      createdAt: minsAgo(60),
    },
    {
      type: 'document',
      id: 'doc-long',
      name: LONG_FILENAME,
      fileType: 'md',
      ownerId: ALICE_ID,
      updatedAt: minsAgo(8),
      createdAt: minsAgo(65),
    },
    {
      type: 'document',
      id: 'doc-handbook',
      name: 'Employee Handbook.pdf',
      fileType: 'pdf',
      ownerId: ALICE_ID,
      updatedAt: minsAgo(14),
      createdAt: minsAgo(120),
    },
    {
      type: 'document',
      id: 'doc-q3-spec',
      name: 'Launch Readiness Checklist.md',
      fileType: 'md',
      ownerId: ALICE_ID,
      projectId: 'folder-q3',
      updatedAt: minsAgo(6),
      createdAt: minsAgo(80),
    },
    {
      type: 'document',
      id: 'doc-design-hero',
      name: 'Brand Hero Mockup.png',
      fileType: 'png',
      ownerId: ALICE_ID,
      projectId: 'folder-design',
      updatedAt: minsAgo(18),
      createdAt: minsAgo(90),
    },
    {
      type: 'document',
      id: 'doc-shared-sla',
      name: 'Partner SLA Terms.pdf',
      fileType: 'pdf',
      ownerId: BOB_ID,
      projectId: 'folder-partner',
      updatedAt: minsAgo(22),
      createdAt: minsAgo(140),
    },
    {
      type: 'document',
      id: 'doc-agent-summary',
      name: 'Daily Research Digest.md',
      fileType: 'md',
      ownerId: 'macro|research-agent@seed.macro.local',
      updatedAt: minsAgo(3),
      createdAt: minsAgo(30),
    },
  ];

  // 40 archive documents inside Quarterly Archive to test large folder handling.
  for (let i = 1; i <= 40; i += 1) {
    docs.push({
      type: 'document',
      id: `doc-archive-${i}`,
      name: `Weekly Metrics Report #${String(i).padStart(2, '0')}`,
      fileType: 'md',
      ownerId: ALICE_ID,
      projectId: 'folder-archive',
      updatedAt: minsAgo(60 + i),
      createdAt: minsAgo(600 + i),
    });
  }

  return docs;
}

function DriveRedesignFixture() {
  useHotKeyRoot();
  const [attachSplit, scopeId] = useHotkeyDOMScope('drive-fixture-split');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  const router = createSplitRouter({
    routes: {
      definitions: [
        {
          ...appRoute,
          children: [
            { ...driveSplitRoute, children: [driveRootDocumentRoute] },
            legacyContentRoute,
          ],
        },
      ],
      defaultRoute: () => ({
        matches: [
          { id: 'app', params: {} },
          { id: 'drive', params: {} },
        ],
      }),
    },
    history: createMemoryHistory('/drive'),
    paneStore: createMemoryPaneStore(),
    policy: createTestPolicy().policy,
  });
  onCleanup(() => router.dispose());

  const [folders, setFolders] = createSignal<DriveFolderMetadata[]>([
    ...INITIAL_FOLDERS,
  ]);
  const [docs, setDocs] = createSignal<EntityData[]>(makeInitialDocs());
  const [trashed, setTrashed] = createSignal<DriveTrashItem[]>([
    {
      id: 'trash-old-draft',
      itemType: 'document',
      name: 'Deprecated Onboarding Draft.md',
      fileType: 'md',
      deletedAt: minsAgo(12),
      updatedAt: minsAgo(20),
      ownerId: ALICE_ID,
      parentFolderId: 'folder-product',
    },
  ]);
  const [favorites, setFavorites] = createSignal<Favorite[]>([
    {
      entityId: 'doc-plan',
      entityType: 'document',
      fileType: 'md',
      sortOrder: 0,
      createdAt: minsAgo(10),
    },
  ]);
  const [openedLog, setOpenedLog] = createSignal<string[]>([]);

  const [rawState, setRawState] = createSignal<DriveState>({
    location: { kind: 'tab', tab: 'owned' },
    scope: 'default',
    sort: 'updated_at',
    search: '',
    facets: {},
    rootOpen: true,
    favoritesOpen: true,
    databasesOpen: true,
    expandedFolderIds: [],
  });

  const AGENT_ID = 'macro|research-agent@seed.macro.local';
  const [askAiCalls, setAskAiCalls] = createSignal(0);

  const matchesFilters = (
    entity: EntityData,
    term: string,
    facets: DriveState['facets']
  ): boolean => {
    if (term && !entity.name.toLocaleLowerCase().includes(term)) return false;
    const typeFilter = facets.type ?? [];
    if (typeFilter.length > 0) {
      if (entity.type !== 'document') return false;
      const ft = (entity.fileType ?? '').toLowerCase();
      const matchedType =
        (typeFilter.includes('file-pdf') && ft === 'pdf') ||
        (typeFilter.includes('doc-markdown') && ft === 'md');
      if (!matchedType) return false;
    }
    const creatorFilter = facets['created-by'] ?? [];
    if (creatorFilter.length > 0) {
      const allowed = new Set(
        creatorFilter.flatMap((id) =>
          resolveCreatorOptionIds(id, {
            userId: ALICE_ID,
            myAgentIds: [AGENT_ID],
            teamAgentIds: [AGENT_ID],
          })
        )
      );
      if (
        !('ownerId' in entity) ||
        !entity.ownerId ||
        !allowed.has(entity.ownerId)
      ) {
        return false;
      }
    }
    const modifiedFilter = (facets.modified ?? []).filter(
      isDriveModifiedPreset
    );
    if (modifiedFilter.length > 0) {
      const matchedModified = modifiedFilter.some((preset) =>
        matchesDateRange(
          'updatedAt' in entity ? entity.updatedAt : undefined,
          modifiedPresetRange(preset)
        )
      );
      if (!matchedModified) return false;
    }
    return true;
  };

  const candidatesForLocation = (
    location: DriveState['location'],
    hasTypeFilter: boolean,
    hasCreatorFilter: boolean
  ): EntityData[] => {
    if (location.kind === 'folder' && location.id) {
      const childFolders = hasTypeFilter
        ? []
        : folders()
            .filter((folder) => folder.parentId === location.id)
            .map(folderToProjectEntity);
      const childDocs = docs().filter(
        (doc) => 'projectId' in doc && doc.projectId === location.id
      );
      return [...childFolders, ...childDocs];
    }
    if (location.kind !== 'tab') return [];
    if (location.tab === 'shared') {
      return docs().filter(
        (doc) => 'ownerId' in doc && doc.ownerId !== ALICE_ID
      );
    }
    if (location.tab === 'owned') {
      return hasCreatorFilter
        ? docs()
        : docs().filter((doc) => 'ownerId' in doc && doc.ownerId === ALICE_ID);
    }
    if (location.tab === 'recent') return docs().slice(0, 8);
    return [];
  };

  const buildItemsFor = (
    location: DriveState['location'],
    search: string,
    facets: DriveState['facets']
  ): DriveListItem[] => {
    const term = search.trim().toLocaleLowerCase();
    const typeFilter = facets.type ?? [];
    const creatorFilter = facets['created-by'] ?? [];
    return candidatesForLocation(
      location,
      typeFilter.length > 0,
      creatorFilter.length > 0
    )
      .filter((entity) => matchesFilters(entity, term, facets))
      .map((entity) => ({ kind: 'entity' as const, id: entity.id, entity }));
  };

  const mainItems = createMemo(() =>
    buildItemsFor(rawState().location, rawState().search, rawState().facets)
  );

  const source: DriveListSource = {
    items: mainItems,
    isLoading: () => false,
    isFetching: () => false,
    isLoadingMore: () => false,
    hasMore: () => false,
    hasData: () => true,
    error: () => undefined,
    databaseError: () => undefined,
    featuredIds: () => [],
    deferInteractions: () => false,
    loadMore: async () => {},
    refresh: async () => {},
  };

  const createFolderContents = (
    folderId: Accessor<string | null>
  ): DriveListSource => {
    const items = createMemo(() => {
      const id = folderId();
      return buildItemsFor(
        id === null ? { kind: 'tab', tab: 'owned' } : { kind: 'folder', id },
        '',
        {}
      );
    });
    return {
      items,
      isLoading: () => false,
      isFetching: () => false,
      isLoadingMore: () => false,
      hasMore: () => false,
      hasData: () => true,
      error: () => undefined,
      databaseError: () => undefined,
      featuredIds: () => [],
      deferInteractions: () => false,
      loadMore: async () => {},
      refresh: async () => {},
    };
  };

  const list = createDriveList({
    source,
    onActivate: (row) => setOpenedLog((prev) => [...prev, row.entity.name]),
  });

  const state = createDriveState({
    state: rawState,
    setState: setRawState,
    folders,
    list,
    showList: () => {},
  });

  const sidebar: DriveSidebarSource = {
    folders,
    foldersLoading: () => false,
    foldersError: () => false,
    retryFolders: async () => {},
    favorites,
    databases: () => [],
  };

  const preferences = createDriveViewPreferences();
  const inlineEdit = createDriveInlineEdit();
  const inspector = createDriveInspector({
    open: preferences.inspectorOpen,
    setOpen: preferences.setInspectorOpen,
  });
  const [inspectedEntity, setInspectedEntity] = createSignal<
    EntityData | undefined
  >();
  const [selectedEntities, setSelectedEntities] = createSignal<EntityData[]>(
    []
  );
  let clearSelectionHandler: (() => void) | undefined;
  let focusSearchHandler: (() => void) | undefined;

  const undo = createDriveUndoManager({
    undoMove: async (items) => {
      for (const entry of items) {
        if (entry.entity.type === 'project') {
          setFolders((prev) =>
            prev.map((f) =>
              f.id === entry.entity.id
                ? { ...f, parentId: entry.previousProjectId }
                : f
            )
          );
        } else {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === entry.entity.id
                ? { ...d, projectId: entry.previousProjectId ?? undefined }
                : d
            )
          );
        }
      }
      return true;
    },
    undoRename: async (entity, previousName) => {
      if (entity.type === 'project') {
        setFolders((prev) =>
          prev.map((f) =>
            f.id === entity.id ? { ...f, name: previousName } : f
          )
        );
      } else {
        setDocs((prev) =>
          prev.map((d) =>
            d.id === entity.id ? { ...d, name: previousName } : d
          )
        );
      }
      return true;
    },
    undoTrash: async (items) => {
      for (const entity of items) {
        const found = trashed().find((item) => item.id === entity.id);
        setTrashed((prev) => prev.filter((item) => item.id !== entity.id));
        if (found && found.itemType === 'project') {
          setFolders((prev) => [
            ...prev,
            {
              id: found.id,
              name: found.name,
              parentId: found.parentFolderId ?? null,
              userId: ALICE_ID,
              createdAt: minsAgo(30),
              updatedAt: minsAgo(1),
            },
          ]);
        } else if (found) {
          setDocs((prev) => [
            {
              type: 'document',
              id: found.id,
              name: found.name,
              fileType: found.fileType ?? 'md',
              ownerId: ALICE_ID,
              projectId: found.parentFolderId ?? undefined,
              updatedAt: minsAgo(1),
              createdAt: minsAgo(30),
            },
            ...prev,
          ]);
        }
      }
      return true;
    },
  });

  const trashSource: DriveTrashSource = {
    items: trashed,
    isLoading: () => false,
    isFetching: () => false,
    isLoadingMore: () => false,
    hasMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
    refresh: async () => {},
    restoreItems: async (targets) => {
      const ids = new Set(targets.map((t) => t.id));
      const restoring = trashed().filter((item) => ids.has(item.id));
      setTrashed((prev) => prev.filter((item) => !ids.has(item.id)));
      for (const item of restoring) {
        if (item.itemType === 'project') {
          setFolders((prev) => [
            ...prev,
            {
              id: item.id,
              name: item.name,
              parentId: item.parentFolderId ?? null,
              userId: ALICE_ID,
              createdAt: minsAgo(30),
              updatedAt: minsAgo(1),
            },
          ]);
        } else {
          setDocs((prev) => [
            {
              type: 'document',
              id: item.id,
              name: item.name,
              fileType: item.fileType ?? 'md',
              ownerId: ALICE_ID,
              projectId: item.parentFolderId ?? undefined,
              updatedAt: minsAgo(1),
              createdAt: minsAgo(30),
            },
            ...prev,
          ]);
        }
      }
      return { restored: restoring.length, failed: 0 };
    },
    permanentlyDeleteItems: async (targets) => {
      const ids = new Set(targets.map((t) => t.id));
      const count = trashed().filter((item) => ids.has(item.id)).length;
      setTrashed((prev) => prev.filter((item) => !ids.has(item.id)));
      return { deleted: count, failed: 0 };
    },
  };

  let createdSeq = 1;
  const host: DriveRedesignHostActions = {
    createFolderInline: async (name, parentId) => {
      const id = `folder-created-${createdSeq++}`;
      setFolders((prev) => [
        ...prev,
        {
          id,
          name: name.trim(),
          parentId,
          userId: ALICE_ID,
          createdAt: minsAgo(0),
          updatedAt: minsAgo(0),
        },
      ]);
      return id;
    },
    openCreateFolderWithFiles: () => {},
    renameEntityInline: async (entity, nextName) => {
      const previousName = entity.name;
      if (entity.type === 'project') {
        setFolders((prev) =>
          prev.map((f) => (f.id === entity.id ? { ...f, name: nextName } : f))
        );
      } else {
        setDocs((prev) =>
          prev.map((d) => (d.id === entity.id ? { ...d, name: nextName } : d))
        );
      }
      undo.recordRename({
        entity: {
          id: entity.id,
          type: entity.type === 'project' ? 'project' : 'document',
          name: nextName,
        },
        previousName,
        nextName,
      });
      return true;
    },
    moveEntitiesWithUndo: async (
      entities,
      destinationFolderId,
      destinationName
    ) => {
      const undoItems = entities.map((entity) => ({
        entity: {
          id: entity.id,
          type: (entity.type === 'project' ? 'project' : 'document') as
            | 'project'
            | 'document',
          name: entity.name,
        },
        previousProjectId:
          'projectId' in entity ? (entity.projectId ?? null) : null,
      }));
      for (const entity of entities) {
        if (entity.type === 'project') {
          setFolders((prev) =>
            prev.map((f) =>
              f.id === entity.id ? { ...f, parentId: destinationFolderId } : f
            )
          );
        } else {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === entity.id
                ? { ...d, projectId: destinationFolderId ?? undefined }
                : d
            )
          );
        }
      }
      undo.recordMove({
        items: undoItems,
        destinationFolderId,
        destinationName,
      });
      return true;
    },
    openMoveDialog: () => {},
    trashEntitiesWithUndo: async (entities) => {
      const ids = new Set(entities.map((e) => e.id));
      const newTrash: DriveTrashItem[] = entities.map((entity) => ({
        id: entity.id,
        itemType: entity.type === 'project' ? 'project' : 'document',
        name: entity.name,
        fileType: 'fileType' in entity ? entity.fileType : undefined,
        deletedAt: minsAgo(0),
        updatedAt: minsAgo(0),
        ownerId: ALICE_ID,
        parentFolderId:
          'projectId' in entity ? (entity.projectId ?? null) : null,
      }));
      setFolders((prev) => prev.filter((f) => !ids.has(f.id)));
      setDocs((prev) => prev.filter((d) => !ids.has(d.id)));
      setTrashed((prev) => [...newTrash, ...prev]);
      undo.recordTrash(
        entities.map((e) => ({
          id: e.id,
          type: e.type === 'project' ? 'project' : 'document',
          name: e.name,
        }))
      );
      return true;
    },
    toggleStarEntities: async (entities) => {
      setFavorites((prev) => {
        const next = [...prev];
        for (const entity of entities) {
          const idx = next.findIndex((f) => f.entityId === entity.id);
          if (idx >= 0) {
            next.splice(idx, 1);
          } else {
            next.push({
              entityId: entity.id,
              entityType: entity.type === 'project' ? 'project' : 'document',
              fileType: 'fileType' in entity ? (entity.fileType ?? null) : null,
              sortOrder: next.length,
              createdAt: minsAgo(0),
            });
          }
        }
        return next;
      });
    },
    isStarred: (entity) => favorites().some((f) => f.entityId === entity.id),
    unstarFavorite: async (fav) => {
      setFavorites((prev) => prev.filter((f) => f.entityId !== fav.entityId));
    },
    duplicateEntities: async () => {},
    shareEntities: () => {},
    copyLink: async () => {},
    createNewItem: (blockName) => {
      const id = `doc-created-${createdSeq++}`;
      setDocs((prev) => [
        {
          type: 'document',
          id,
          name: `Untitled ${blockName}`,
          fileType: blockName === 'md' ? 'md' : 'md',
          ownerId: ALICE_ID,
          projectId: state.projectId(),
          updatedAt: minsAgo(0),
          createdAt: minsAgo(0),
        },
        ...prev,
      ]);
    },
    undoLatestWithToast: async () => {
      await undo.undoLatest();
    },
    canMutateEntity: (entity) =>
      !('ownerId' in entity) || entity.ownerId === ALICE_ID,
    openFolderInNewSplit: () => {},
    askAi: async () => {
      setAskAiCalls((count) => count + 1);
    },
  };

  const actions: DriveHostActions = {
    userId: () => ALICE_ID,
    canOpenNewSplit: () => false,
    openEntity: (entity) => {
      if (entity.type === 'project') {
        state.selectFolder(entity.id);
      } else {
        setOpenedLog((prev) => [...prev, entity.name]);
      }
    },
    openShortcut: (entity) => setOpenedLog((prev) => [...prev, entity.name]),
    openFavorite: (_fav, name) => setOpenedLog((prev) => [...prev, name]),
    openCreated: () => true,
    openFolderInNewSplit: () => {},
    shareFolder: () => {},
    uploadFiles: () => {},
    uploadFolder: () => {},
    dropFiles: () => {},
  };

  const knownFolders = createMemo(
    () =>
      new Map<string, KnownFolder>(
        folders().map((f) => [
          f.id,
          { id: f.id, name: f.name, parentId: f.parentId, ownerId: f.userId },
        ])
      )
  );

  const panel = {
    handle: {
      id: 'fixture-pane',
      isFirst: () => true,
      content: () => ({ type: 'drive', state: {} }),
    },
    isPanelActive: () => true,
    splitHotkeyScope: scopeId,
    panelRef: () => document.getElementById('fixture-main') ?? undefined,
    contentOffsetTop: () => 0,
  } as unknown as SplitPanelContextType;

  const isTrash = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'trash';
  };
  const isStarred = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'starred';
  };
  const isRecent = () => {
    const loc = state.value().location;
    return loc.kind === 'tab' && loc.tab === 'recent';
  };
  const startInlineFolder = () => {
    const mode = preferences.viewMode();
    inlineEdit.startCreateFolder({
      parentId: state.projectId() ?? null,
      surface:
        mode === 'grid' ? 'grid' : mode === 'columns' ? 'columns' : 'list',
    });
  };

  return (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <EmailLinksContextProvider>
          <SplitRouter.Root router={router}>
            <SplitRouter.Scope pane={router.panes()[0]!}>
              <TagSetsProvider tagSets={() => []}>
                <DragDropProvider>
                  <DragDropSensors />
                  <KnownFoldersProvider value={knownFolders}>
                    <SplitPanelContext.Provider value={panel}>
                      <DriveProvider
                        value={{
                          state,
                          source,
                          list,
                          sidebar,
                          actions,
                          tutorials: () => [],
                        }}
                      >
                        <DriveRedesignProvider
                          value={{
                            preferences,
                            inlineEdit,
                            inspector,
                            undo,
                            trash: trashSource,
                            host,
                            agents: {
                              myAgents: () => [
                                {
                                  userId: AGENT_ID,
                                  teamId: 'team-1',
                                  name: 'Research Agent',
                                  createdBy: ALICE_ID,
                                  createdAt: minsAgo(500),
                                  jobDescription: 'Research',
                                  personality: 'Direct',
                                  status: 'running',
                                },
                              ],
                              teamAgents: () => [
                                {
                                  userId: AGENT_ID,
                                  teamId: 'team-1',
                                  name: 'Research Agent',
                                  createdBy: ALICE_ID,
                                  createdAt: minsAgo(500),
                                  jobDescription: 'Research',
                                  personality: 'Direct',
                                  status: 'running',
                                },
                              ],
                              myAgentIds: () => [AGENT_ID],
                              teamAgentIds: () => [AGENT_ID],
                              hasTeamAgents: () => true,
                            },
                            createFolderContents,
                            inspectedEntity,
                            setInspectedEntity,
                            selectedEntities,
                            setSelectedEntities,
                            clearActiveSelection: () =>
                              clearSelectionHandler?.(),
                            registerClearSelection: (handler) => {
                              clearSelectionHandler = handler;
                              return () => {
                                if (clearSelectionHandler === handler) {
                                  clearSelectionHandler = undefined;
                                }
                              };
                            },
                            focusSearch: () => focusSearchHandler?.(),
                            registerFocusSearch: (handler) => {
                              focusSearchHandler = handler;
                              return () => {
                                if (focusSearchHandler === handler) {
                                  focusSearchHandler = undefined;
                                }
                              };
                            },
                          }}
                        >
                          <div
                            ref={(el) => attachGlobalDOMScope(el)}
                            data-ask-ai-calls={askAiCalls()}
                            class="flex h-screen w-screen overflow-hidden bg-page text-ink"
                          >
                            <div
                              id="fixture-main"
                              ref={attachSplit}
                              class="flex size-full min-h-0 min-w-0 flex-1 overflow-hidden"
                            >
                              <Show
                                when={isMobileFixture}
                                fallback={
                                  <ViewShell.Root
                                    contentLayout="collection"
                                    asidePreferenceKey="documents"
                                    aside={{ preserveDuringResize: false }}
                                    main={{ preferredWidth: 680 }}
                                  >
                                    <ViewShell.Aside>
                                      <nav
                                        aria-label="Drive views"
                                        class="flex h-full flex-col gap-1 border-r border-edge-muted bg-panel p-3 text-sm"
                                      >
                                        <button
                                          type="button"
                                          class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                          onClick={() =>
                                            state.selectTab('owned')
                                          }
                                        >
                                          My Drive
                                        </button>
                                        <button
                                          type="button"
                                          class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                          onClick={() =>
                                            state.selectTab('recent')
                                          }
                                        >
                                          Recent
                                        </button>
                                        <button
                                          type="button"
                                          class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                          onClick={() =>
                                            state.selectTab('shared')
                                          }
                                        >
                                          Shared with me
                                        </button>
                                        <button
                                          type="button"
                                          class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                          onClick={() =>
                                            state.selectTab('starred')
                                          }
                                        >
                                          Starred
                                        </button>
                                        <button
                                          type="button"
                                          class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                          onClick={() =>
                                            state.selectTab('trash')
                                          }
                                        >
                                          Trash
                                        </button>
                                        <div class="mt-3 px-2.5 text-xs font-semibold text-ink-muted">
                                          Folders
                                        </div>
                                        <For
                                          each={folders().filter(
                                            (f) =>
                                              !f.parentId &&
                                              f.userId === ALICE_ID
                                          )}
                                        >
                                          {(folder) => (
                                            <button
                                              type="button"
                                              class="rounded-lg px-2.5 py-1.5 text-left hover:bg-hover"
                                              onClick={() =>
                                                state.selectFolder(folder.id)
                                              }
                                            >
                                              {folder.name}
                                            </button>
                                          )}
                                        </For>
                                      </nav>
                                    </ViewShell.Aside>
                                    <CollectionPanes
                                      hasDetail={false}
                                      list={
                                        <div class="flex size-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
                                          <DriveRedesignHeader
                                            onStartInlineFolder={
                                              startInlineFolder
                                            }
                                          />
                                          <ViewShell.Content>
                                            <div class="flex size-full min-h-0 min-w-0 flex-row overflow-hidden">
                                              <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                                                <Switch>
                                                  <Match when={isTrash()}>
                                                    <DriveRedesignTrash />
                                                  </Match>
                                                  <Match when={isStarred()}>
                                                    <DriveRedesignStarred />
                                                  </Match>
                                                  <Match
                                                    when={
                                                      preferences.viewMode() ===
                                                        'columns' && !isRecent()
                                                    }
                                                  >
                                                    <DriveRedesignColumns />
                                                  </Match>
                                                  <Match
                                                    when={
                                                      preferences.viewMode() ===
                                                      'grid'
                                                    }
                                                  >
                                                    <DriveRedesignGrid
                                                      onStartInlineFolder={
                                                        startInlineFolder
                                                      }
                                                    />
                                                  </Match>
                                                  <Match when={true}>
                                                    <DriveRedesignList
                                                      onStartInlineFolder={
                                                        startInlineFolder
                                                      }
                                                    />
                                                  </Match>
                                                </Switch>
                                              </div>
                                              <Show
                                                when={
                                                  !isTrash() && !isStarred()
                                                }
                                              >
                                                <DriveRedesignInspector />
                                              </Show>
                                            </div>
                                          </ViewShell.Content>
                                        </div>
                                      }
                                    >
                                      {null}
                                    </CollectionPanes>
                                  </ViewShell.Root>
                                }
                              >
                                <DriveRedesignMobileWorkspace />
                              </Show>
                            </div>
                            <div data-testid="opened-log" class="sr-only">
                              {openedLog().join('|')}
                            </div>
                            <ImperativeDialogHost />
                          </div>
                        </DriveRedesignProvider>
                      </DriveProvider>
                    </SplitPanelContext.Provider>
                  </KnownFoldersProvider>
                </DragDropProvider>
              </TagSetsProvider>
            </SplitRouter.Scope>
          </SplitRouter.Root>
        </EmailLinksContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  render(
    () => (
      <AnalyticsContextProvider>
        <PosthogProvider>
          <CreateContextProvider focusedPaneId={() => 'fixture-pane'}>
            <MemoryRouter>
              <Route path="*" component={DriveRedesignFixture} />
            </MemoryRouter>
          </CreateContextProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    ),
    root
  );
}

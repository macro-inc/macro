import { t } from '@app/lib/i18n';
import { replacePaneSearchParams } from '@app/lib/split-router';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import InfoIcon from '@phosphor/info.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import {
  Button,
  ButtonGroup,
  type DialogHandle,
  Dropdown,
  openDialog,
} from '@ui';
import { ok } from 'neverthrow';
import { batch, For, getOwner, type Owner, onCleanup, Show } from 'solid-js';
import { v4 as uuid } from 'uuid';
import {
  SavedViewList,
  SavedViewListRow,
} from '../../saved-views/components/saved-view-list';
import { SavedViewMenuItems } from '../../saved-views/components/saved-view-menu';
import { SavedViewPicker } from '../../saved-views/components/saved-view-picker';
import type { SavedView } from '../../saved-views/core/saved-view';
import {
  savedViewErrorMessage,
  useUpdateSavedView,
} from '../../saved-views/queries/saved-view-actions';
import { toSavedView } from '../../saved-views/queries/saved-views';
import {
  DeleteSavedViewDialog,
  SavedViewDialog,
} from '../../saved-views/views/saved-view-dialogs';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import {
  decodeTaskSavedView,
  materializeTaskSavedView,
  readTaskSavedView,
  type TaskSavedViewConfig,
  type TaskSavedViewIssue,
  withTaskTabFilters,
} from '../filters/task-saved-view';
import { useTaskFilters } from '../filters/use-task-filters';
import { taskSavedViewTitle } from '../primitives/create-task-saved-view-draft';
import { tasksTabSearch, tasksTabSearchCodec } from '../tasks-tab-search';
import { useTasksView } from '../tasks-view-context';

const LAYOUT_LABELS = { list: 'List', board: 'Board', gantt: 'Gantt' };

function TaskSavedViewSummary(props: {
  config: TaskSavedViewConfig;
  omittedFilters?: TaskSavedViewIssue[];
}) {
  const { state } = useTasksView();
  const filters = useTaskFilters();
  const selection = () => materializeTaskSavedView(props.config);
  return (
    <>
      <Show when={props.omittedFilters?.length}>
        <p role="alert" class="rounded-lg bg-failure-bg p-3 text-failure-ink">
          Unsupported filters or view settings will not be copied. If no filters
          are supported, the copy will be unfiltered. The original view stays
          unchanged.
        </p>
      </Show>
      <For each={filters.groups()}>
        {(group) => (
          <Show when={(selection().facets[group.id] ?? []).length}>
            <p>
              {group.label}:{' '}
              {(selection().facets[group.id] ?? [])
                .map(
                  (id) =>
                    group.options.find((option) => option.id === id)?.label ??
                    'Unavailable option'
                )
                .join(', ')}
            </p>
          </Show>
        )}
      </For>
      <p>Layout: {LAYOUT_LABELS[props.config.layout]}</p>
      <p>
        Group by:{' '}
        {
          TASK_GROUP_OPTIONS.find(
            (option) => option.id === props.config.groupBy
          )?.label
        }
      </p>
      <p>
        Sort:{' '}
        {props.config.sort
          .map(
            (sort) =>
              `${TASK_SORT_OPTIONS.find((option) => option.id === sort.id)?.label} (${sort.reversed ? 'oldest first' : 'newest first'})`
          )
          .join(', ') || 'Default'}
      </p>
      <Show when={state.search.trim()}>
        <p>Search text is not included.</p>
      </Show>
    </>
  );
}

/** The host scope survives menu handoffs and expires on navigation or disposal. */
function useTaskSavedViewRequest() {
  const { savedViews, savedViewScope } = useTasksView();
  return () => {
    const scope = savedViewScope();
    return {
      revision: savedViews?.revision() ?? 0,
      isCurrent: (id?: string) =>
        Boolean(
          scope && scope === savedViewScope() && (!id || id === scope.id)
        ),
    };
  };
}

function useReloadTaskSavedView() {
  const { savedViews, savedViewSource } = useTasksView();
  const captureRequest = useTaskSavedViewRequest();
  return async () => {
    if (!savedViews || !savedViewSource) return;
    const request = captureRequest();
    await savedViewSource.refresh();
    const record = savedViewSource.data();
    if (record && request.isCurrent(record.id)) savedViews.reset(record);
  };
}
/** Creation is shared by capture, duplication, and the unsaved-view toolbar. */
function useCreateTaskSavedViewDialog(owner = getOwner()) {
  const {
    savedViews,
    savedViewsList,
    savedViewTeam,
    state,
    setState,
    selectCreatedSavedView,
  } = useTasksView();
  const captureRequest = useTaskSavedViewRequest();
  const viewerId = useUserId();
  return (record?: SavedView) => {
    if (!savedViews || !savedViewsList) return;
    const selection = savedViews.view();
    const stored = record ? readTaskSavedView(record.config) : undefined;
    const definition =
      stored &&
      !(selection.kind === 'saved' && selection.record.id === record?.id)
        ? ok(stored.config)
        : savedViews.capture();
    if (definition.isErr()) {
      toast.failure(definition.error);
      return;
    }
    const config = definition.value;
    const id = uuid();
    const request = captureRequest();
    return openDialog(
      SavedViewDialog,
      () => ({
        refresh: savedViewsList.refresh,
        viewerId,
        isCurrent: request.isCurrent,
        mode: 'create' as const,
        id,
        name: record ? `${record.name.slice(0, 113)} (copy)` : 'New view',
        config,
        title: record ? 'Duplicate saved view' : 'Save view',
        submitLabel: record ? 'Duplicate' : 'Save view',
        team: savedViewTeam?.(),
        summary: (
          <TaskSavedViewSummary
            config={config}
            omittedFilters={stored?.issues}
          />
        ),
        onSaved: (created: SavedView) => {
          const decoded = decodeTaskSavedView(created.config);
          if (decoded.isErr()) {
            toast.failure(decoded.error);
            return;
          }
          if (
            !request.isCurrent() ||
            savedViews.revision() !== request.revision
          )
            return;
          const facets = withTaskTabFilters(state.tab, state.facets);
          batch(() => {
            if (!savedViews.acceptConfirmed(created)) return;
            setState('tab', 'team-tasks');
            setState(
              'facets',
              record ? materializeTaskSavedView(decoded.value).facets : facets
            );
            if (record) {
              const restored = materializeTaskSavedView(decoded.value);
              setState({
                layout: restored.layout,
                groupBy: restored.groupBy,
                sort: restored.sort,
              });
            }
            selectCreatedSavedView(created.id);
          });
        },
      }),
      { owner }
    );
  };
}

function TaskSavedViewMenuItems(props: {
  record: SavedView;
  owner: Owner | null;
  defer: (action: () => void) => void;
}) {
  const {
    savedViews,
    savedViewsList,
    savedViewTeam,
    savedViewScope,
    leaveSavedView,
  } = useTasksView();
  const captureRequest = useTaskSavedViewRequest();
  const viewerId = useUserId();
  const create = useCreateTaskSavedViewDialog(props.owner);
  const edit = () => {
    if (!savedViews || !savedViewsList) return;
    const record = props.record;
    const request = captureRequest();
    props.defer(() =>
      openDialog(
        SavedViewDialog,
        () => ({
          mode: 'edit' as const,
          refresh: savedViewsList.refresh,
          viewerId,
          record,
          team: savedViewTeam?.(),
          isCurrent: request.isCurrent,
          onSaved: (updated) => {
            if (request.isCurrent(updated.id))
              savedViews.acceptConfirmed(updated);
          },
        }),
        { owner: props.owner }
      )
    );
  };
  const remove = () => {
    if (!savedViews || !savedViewsList) return;
    const record = props.record;
    const request = captureRequest();
    props.defer(() =>
      openDialog(
        DeleteSavedViewDialog,
        {
          refresh: savedViewsList.refresh,
          viewerId,
          record,
          isCurrent: request.isCurrent,
          onDeleted: (deleted, viewer) => {
            const scope = savedViewScope();
            if (scope?.id === deleted.id && scope.viewerId === viewer)
              leaveSavedView();
          },
        },
        { owner: props.owner }
      )
    );
  };
  return (
    <SavedViewMenuItems
      owned={props.record.ownerId === viewerId()}
      onEdit={edit}
      onDelete={remove}
      onDuplicate={() => {
        const record = props.record;
        props.defer(() => create(record));
      }}
      onCopyLink={() =>
        fireAndForget(copySavedViewLink(props.record.id), 'saved-views')
      }
    />
  );
}

function useTaskSavedViewListState() {
  const { savedViews, savedViewsList } = useTasksView();
  const viewerId = useUserId();
  const creating = () => savedViews?.view().kind === 'new';
  const items = () => {
    const records = savedViewsList?.items();
    const selection = savedViews?.view();
    // Keep confirmed creations visible without restoring a revoked shared view.
    if (
      selection?.kind === 'saved' &&
      selection.record.ownerId === viewerId() &&
      !records?.some((record) => record.id === selection.record.id)
    )
      return [selection.record, ...(records ?? [])];
    return records;
  };
  return {
    creating,
    items,
    empty: () =>
      !creating() && !savedViewsList?.loading() && items()?.length === 0,
  };
}

export function TaskSavedViewsList() {
  const {
    savedViews,
    savedViewsList,
    startSavedView,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useTasksView();
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-saved-view', true);
  const create = () => {
    setSidebarSectionOpen('saved-views', true);
    startSavedView();
  };
  return (
    <Show when={savedViews && savedViewsList}>
      <SavedViewList.Root
        open={isSidebarSectionOpen('saved-views')}
        onOpenChange={(open) => setSidebarSectionOpen('saved-views', open)}
      >
        <SavedViewList.Header
          onCreate={create}
          createButtonRef={attachCreateHotkeys}
        />
        <SavedViewList.Content>
          <TaskSavedViewRows />
        </SavedViewList.Content>
      </SavedViewList.Root>
    </Show>
  );
}

function TaskSavedViewRows(props: {
  onAction?: (action: () => void) => void;
  dialogOwner?: Owner | null;
}) {
  const {
    savedViews,
    savedViewsList,
    selectSavedView,
    startSavedView,
    closeTask,
  } = useTasksView();
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-saved-view', true);
  const viewerId = useUserId();
  const owner = props.dialogOwner ?? getOwner();
  const selectedId = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.record.id : undefined;
  };
  const { creating, items, empty } = useTaskSavedViewListState();
  const run = (action: () => void) =>
    props.onAction ? props.onAction(action) : action();
  return (
    <Show when={savedViews && savedViewsList}>
      {(views) => (
        <>
          <SavedViewList.Items>
            <Show when={creating()}>
              <SavedViewList.Draft onSelect={() => run(closeTask)} />
            </Show>
            <For each={items()}>
              {(record) => (
                <SavedViewListRow
                  view={record}
                  selected={selectedId() === record.id}
                  scopeKey={viewerId()}
                  onSelect={() => run(() => selectSavedView(record.id))}
                  menu={(defer) => (
                    <TaskSavedViewMenuItems
                      record={record}
                      owner={owner}
                      defer={(action) => defer(() => run(action))}
                    />
                  )}
                />
              )}
            </For>
          </SavedViewList.Items>
          <Show when={views().loading() && !items()}>
            <p class="px-3 py-2 text-xs text-ink-muted" role="status">
              Loading views…
            </p>
          </Show>
          <Show when={empty()}>
            <div class="mx-2 my-1 flex flex-col items-start gap-2 rounded-lg border border-edge-muted p-3 group-data-closed/sidebar-section:invisible">
              <div class="space-y-1">
                <p class="text-xs font-medium text-ink">
                  {t('viewMenus.savedViewsEmptyTitle')}
                </p>
                <p class="text-xs text-ink-muted">
                  {t('viewMenus.savedViewsEmptyDescription')}
                </p>
              </div>
              <Button
                ref={attachCreateHotkeys}
                size="sm"
                variant="secondary"
                onClick={() => run(startSavedView)}
              >
                <PlusIcon class="size-3.5" />
                {t('viewMenus.createSavedView')}
              </Button>
            </div>
          </Show>
          <Show when={views().error()}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fireAndForget(views().refresh(), 'saved-views')}
            >
              Retry loading views
            </Button>
          </Show>
          <Show when={views().hasMore()}>
            <Button
              size="sm"
              variant="ghost"
              disabled={views().loadingMore()}
              onClick={() => fireAndForget(views().loadMore(), 'saved-views')}
            >
              Load more views
            </Button>
          </Show>
        </>
      )}
    </Show>
  );
}

export function TaskSavedViewsPicker() {
  const { savedViews, state } = useTasksView();
  const viewerId = useUserId();
  // The drawer closes before its action opens a dialog; retain the outer owner.
  const owner = getOwner();
  return (
    <Show when={savedViews}>
      {(views) => (
        <SavedViewPicker
          active={state.savedViewActive ?? false}
          scopeKey={viewerId()}
          label={
            views().view().kind === 'default'
              ? t('viewMenus.savedViews')
              : taskSavedViewTitle(views().view())
          }
        >
          {(onAction) => (
            <TaskSavedViewRows onAction={onAction} dialogOwner={owner} />
          )}
        </SavedViewPicker>
      )}
    </Show>
  );
}

async function copySavedViewLink(id: string) {
  const params = tasksTabSearchCodec.serialize({
    ...tasksTabSearch.defaults,
    savedView: id,
  });
  if (!params) return;
  const url = new URL('/app/component/tasks', window.location.origin);
  replacePaneSearchParams(url.searchParams, [
    { [tasksTabSearch.namespace]: params },
  ]);
  if (await writeClipboardData({ 'text/plain': url.toString() }))
    toast.success('Link copied');
  else toast.failure('Could not copy link');
}

export function TaskSaveViewButton() {
  const { savedViews } = useTasksView();
  const create = useCreateTaskSavedViewDialog();
  const visible = () => {
    const view = savedViews?.view();
    return view?.kind === 'default' && view.changed;
  };
  return (
    <Show when={visible()}>
      <Button variant="primary" onClick={() => create()}>
        Save view
      </Button>
    </Show>
  );
}

type TaskSavedViewDialogProps = {
  dialogOwner?: Owner | null;
  onCreate?: (create: () => DialogHandle | undefined) => void;
};
export function TaskSavedViewCreateBanner(props: TaskSavedViewDialogProps) {
  const { savedViews, leaveSavedView } = useTasksView();
  const create = useCreateTaskSavedViewDialog(props.dialogOwner ?? getOwner());
  const showCreate = () => (props.onCreate ? props.onCreate(create) : create());
  const creating = () => savedViews?.view().kind === 'new';
  const visible = () => {
    const view = savedViews?.view();
    return (view?.kind === 'default' || view?.kind === 'new') && view.changed;
  };
  return (
    <Show when={visible()}>
      <div
        role="status"
        class="flex shrink-0 items-center gap-2 bg-accent-bg px-3 py-2 text-sm"
      >
        <InfoIcon class="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span class="min-w-0 flex-1">Save these filters as a view</span>
        <Button size="sm" variant="primary" onClick={showCreate}>
          <BookmarkIcon class="size-4" aria-hidden="true" />
          Save view
        </Button>
        <Show when={creating()}>
          <Button size="sm" variant="ghost" onClick={leaveSavedView}>
            Cancel
          </Button>
        </Show>
      </div>
    </Show>
  );
}

export function TaskSavedViewMenu() {
  const { savedViews } = useTasksView();
  const viewerId = useUserId();
  const owner = getOwner();
  let trigger: HTMLButtonElement | undefined;
  let menuOpen = false;
  let disposed = false;
  let pending:
    | { viewer: string | undefined; recordId: string; run: () => void }
    | undefined;
  onCleanup(() => {
    disposed = true;
    pending = undefined;
  });
  const selected = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.record : undefined;
  };
  const defer = (run: () => void) => {
    const record = selected();
    if (record) pending = { viewer: viewerId(), recordId: record.id, run };
  };
  const finish = (event: Event) => {
    const action = pending;
    pending = undefined;
    if (!action) return;
    event.preventDefault();
    queueMicrotask(() => {
      if (
        disposed ||
        menuOpen ||
        action.viewer !== viewerId() ||
        action.recordId !== selected()?.id
      )
        return;
      trigger?.focus({ preventScroll: true });
      action.run();
    });
  };
  return (
    <Show when={selected()}>
      {(record) => (
        <Dropdown
          placement="bottom-start"
          onOpenChange={(open) => {
            menuOpen = open;
            if (open) pending = undefined;
          }}
        >
          <Dropdown.Trigger
            ref={trigger}
            size="icon-md"
            variant="ghost"
            aria-label="Saved view actions"
            tooltip="Saved view actions"
          >
            <DotsIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-44" onCloseAutoFocus={finish}>
            <TaskSavedViewMenuItems
              record={record()}
              owner={owner}
              defer={defer}
            />
          </Dropdown.Content>
        </Dropdown>
      )}
    </Show>
  );
}

export function TaskSavedViewActions(props: TaskSavedViewDialogProps = {}) {
  const { savedViews, savedViewsList, leaveSavedView } = useTasksView();
  const captureRequest = useTaskSavedViewRequest();
  const reload = useReloadTaskSavedView();
  if (!savedViews || !savedViewsList) return null;
  const viewerId = useUserId();
  const create = useCreateTaskSavedViewDialog(props.dialogOwner ?? getOwner());
  const showCreate = (record?: SavedView) =>
    props.onCreate ? props.onCreate(() => create(record)) : create(record);
  const update = useUpdateSavedView({
    refresh: savedViewsList.refresh,
  });
  const selected = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view : undefined;
  };
  let lastRequest: ReturnType<typeof captureRequest> | undefined;
  const save = async () => {
    const view = selected();
    if (
      !savedViews ||
      !view ||
      update.isPending ||
      view.record.ownerId !== viewerId() ||
      view.issues.length > 0
    )
      return;
    const config = savedViews.capture();
    if (config.isErr()) {
      toast.failure(config.error);
      return;
    }
    const request = captureRequest();
    lastRequest = request;
    const release = savedViews.retain();
    try {
      const result = await update.mutateAsync({
        id: view.record.id,
        name: view.record.name,
        config: config.value,
        expectedRevision: view.record.revision,
      });
      if (
        !result.error &&
        result.data?.updateSavedView &&
        request.isCurrent(view.record.id)
      )
        savedViews.acceptConfirmed(toSavedView(result.data.updateSavedView));
    } finally {
      release();
    }
  };
  const failure = () => {
    const error = update.error;
    const pending = update.isPending;
    return !pending && selected()?.dirty && lastRequest?.isCurrent()
      ? error
      : null;
  };
  return (
    <>
      <Show when={savedViews?.view().kind === 'new' || selected()?.dirty}>
        <Show
          when={savedViews?.view().kind === 'new'}
          fallback={
            <HeaderActionGroup label="Saved view actions">
              <Show when={selected()?.record.ownerId === viewerId()}>
                <ButtonGroup.Button
                  variant="primary"
                  class="touch:order-last"
                  disabled={update.isPending || !!selected()?.issues.length}
                  title={
                    selected()?.issues.length
                      ? 'Update the app or remove unsupported settings before saving.'
                      : undefined
                  }
                  onClick={() => fireAndForget(save(), 'saved-views')}
                >
                  Save changes
                </ButtonGroup.Button>
              </Show>
              <ButtonGroup.Button
                variant="ghost"
                onClick={() => savedViews?.reset()}
              >
                Reset
              </ButtonGroup.Button>
            </HeaderActionGroup>
          }
        >
          <div class="flex items-center gap-2">
            <Button variant="primary" onClick={() => showCreate()}>
              Save view
            </Button>
            <Button variant="ghost" onClick={leaveSavedView}>
              Cancel
            </Button>
          </div>
        </Show>
      </Show>
      <Show when={failure()}>
        {(error) => (
          <HeaderActionGroup label="Saved view save error">
            <span
              role="alert"
              class="max-w-48 truncate text-xs text-failure-ink"
              title={savedViewErrorMessage(error())}
            >
              {savedViewErrorMessage(error())}
            </span>
            <Show
              when={error().graphQLErrors[0]?.extensions.code === 'CONFLICT'}
            >
              <ButtonGroup.Button
                variant="ghost"
                onClick={() => fireAndForget(reload(), 'saved-views')}
              >
                Reload saved view
              </ButtonGroup.Button>
            </Show>
            <ButtonGroup.Button
              variant="ghost"
              onClick={() => showCreate(selected()?.record)}
            >
              Duplicate
            </ButtonGroup.Button>
          </HeaderActionGroup>
        )}
      </Show>
    </>
  );
}

/** Missing or unauthorized definitions never fall back to an unfiltered list. */
export function TaskSavedViewFailure() {
  const { savedViews, setTab } = useTasksView();
  const message = () => {
    const view = savedViews?.view();
    return view?.kind === 'unavailable' ? view.message : undefined;
  };
  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm">
      <p role="alert">{message()}</p>
      <Button variant="ghost" onClick={() => setTab('my-tasks')}>
        Return to Tasks
      </Button>
    </div>
  );
}

export function TaskSavedViewWarning() {
  const { savedViews, savedViewsList } = useTasksView();
  const captureRequest = useTaskSavedViewRequest();
  const reload = useReloadTaskSavedView();
  if (!savedViews || !savedViewsList) return null;
  const viewerId = useUserId();
  const update = useUpdateSavedView({ refresh: savedViewsList.refresh });
  const selected = () => {
    const view = savedViews.view();
    return view.kind === 'saved' ? view : undefined;
  };
  const issues = () => selected()?.issues ?? [];
  let lastRequest: ReturnType<typeof captureRequest> | undefined;
  const removeUnsupported = async () => {
    const view = selected();
    if (
      !view?.issues.length ||
      update.isPending ||
      view.record.ownerId !== viewerId()
    )
      return;
    const request = captureRequest();
    lastRequest = request;
    const result = await update.mutateAsync({
      id: view.record.id,
      name: view.record.name,
      config: readTaskSavedView(view.record.config).config,
      expectedRevision: view.record.revision,
    });
    if (
      !result.error &&
      result.data?.updateSavedView &&
      request.isCurrent(view.record.id)
    )
      savedViews.acceptConfirmed(toSavedView(result.data.updateSavedView));
  };
  const failure = () =>
    !update.isPending && lastRequest?.isCurrent() ? update.error : null;
  const labels: Record<string, string> = {
    statusOptionIds: 'Status',
    priorityOptionIds: 'Priority',
    assignees: 'Assignee',
    creators: 'Created by',
    tags: 'Tags',
    kind: 'View type',
    version: 'View version',
    filters: 'Filters',
    layout: 'Layout',
    groupBy: 'Group by',
    sort: 'Sort',
  };
  const skipped = () =>
    [
      ...new Set(
        issues().map(({ path }) => {
          const field = path[0] === 'filters' ? (path[1] ?? path[0]) : path[0];
          return labels[field] ?? field ?? 'Saved definition';
        })
      ),
    ].join(', ');
  return (
    <Show when={issues().length}>
      <div
        role="alert"
        class="flex shrink-0 items-start gap-2 border-b border-failure/30 bg-failure-bg px-4 py-3 text-sm text-failure-ink"
      >
        <WarningIcon class="mt-0.5 size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="font-medium">Some saved settings were skipped.</p>
          <p class="break-words">Skipped settings: {skipped()}</p>
          <Show when={failure()}>
            {(error) => <p>{savedViewErrorMessage(error())}</p>}
          </Show>
        </div>
        <Show when={selected()?.record.ownerId === viewerId()}>
          <div class="flex shrink-0 flex-col items-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={update.isPending}
              onClick={() => fireAndForget(removeUnsupported(), 'saved-views')}
            >
              {update.isPending ? 'Saving…' : 'Remove & save'}
            </Button>
            <Show
              when={failure()?.graphQLErrors[0]?.extensions.code === 'CONFLICT'}
            >
              <Button
                size="sm"
                variant="ghost"
                onClick={() => fireAndForget(reload(), 'saved-views')}
              >
                Reload saved view
              </Button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

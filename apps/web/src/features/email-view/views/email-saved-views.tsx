import { createTagFacetContext } from '@app/features/soup';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { t } from '@app/lib/i18n';
import { replacePaneSearchParams } from '@app/lib/split-router';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import InfoIcon from '@phosphor/info.svg';
import WarningIcon from '@phosphor/warning-circle.svg';
import { useTagSets, useTagSetsReady } from '@property/tags/tag-sets-context';
import { DragDropProvider, DragOverlay } from '@thisbeyond/solid-dnd';
import {
  Button,
  ButtonGroup,
  type DialogHandle,
  Dropdown,
  type ManagedDialogProps,
  openDialog,
} from '@ui';
import {
  type Accessor,
  createSignal,
  For,
  getOwner,
  type JSX,
  type Owner,
  onCleanup,
  Show,
} from 'solid-js';
import { v7 as uuid } from 'uuid';
import { createReorderItem } from '../../../components/drag-drop/create-reorder';
import { createVerticalReorder } from '../../../components/drag-drop/create-vertical-reorder';
import { DragSessionSensors } from '../../../components/drag-drop/drag-session-sensors';
import type { InsertionEdge } from '../../../components/drag-drop/horizontal-insertion';
import { VerticalInsertionLine } from '../../../components/drag-drop/insertion-line';
import {
  SavedViewList,
  SavedViewListRow,
  type SavedViewRowReorder,
} from '../../saved-views/components/saved-view-list';
import { SavedViewMenuItems } from '../../saved-views/components/saved-view-menu';
import { SavedViewPicker } from '../../saved-views/components/saved-view-picker';
import type { SavedView } from '../../saved-views/core/saved-view';
import {
  savedViewErrorMessage,
  useReorderSavedViews,
  useUpdateSavedView,
} from '../../saved-views/queries/saved-view-actions';
import { toSavedView } from '../../saved-views/queries/saved-views';
import {
  DeleteSavedViewDialog,
  SavedViewDialog,
} from '../../saved-views/views/saved-view-dialogs';
import { EmailSavedViewFields } from '../components/EmailSavedViewFields';
import { emailTabSearch, emailTabSearchCodec } from '../email-route';
import { useEmailView } from '../email-view-context';
import {
  canSaveEmailTab,
  decodeEmailSavedView,
  EMAIL_SAVED_VIEW_KIND,
  EMPTY_EMAIL_SAVED_VIEW_FILTERS,
  type EmailSavedViewFilters,
  readEmailSavedView,
} from '../filters/email-saved-view';
import { useEmailDomainSuggestions } from '../queries/use-email-domain-suggestions';
import { useEmailSavedViewUnread } from '../queries/use-email-saved-view-unread';

export const EMAIL_SAVED_VIEWS_SECTION_ID = 'saved-views';

/** The open view's name for headers and breadcrumbs. */
export function useEmailSavedViewTitle(): Accessor<string | undefined> {
  const { savedViews, savedViewActive } = useEmailView();
  return () => {
    if (!savedViewActive()) return undefined;
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.record.name : t('emailViews.view');
  };
}

/** Actions keep the scope they started in; navigation or an account change expires it. */
function useEmailSavedViewRequest() {
  const { savedViews, savedViewScope } = useEmailView();
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

function useReloadEmailSavedView() {
  const { savedViews, savedViewSource } = useEmailView();
  const captureRequest = useEmailSavedViewRequest();
  return async () => {
    if (!savedViews || !savedViewSource) return;
    const request = captureRequest();
    await savedViewSource.refresh();
    const record = savedViewSource.data();
    if (record && request.isCurrent(record.id)) savedViews.reset(record);
  };
}

const configOf = (filters: EmailSavedViewFilters) => ({
  kind: EMAIL_SAVED_VIEW_KIND,
  version: 1,
  filters,
});

type BuilderProps = ManagedDialogProps & {
  refresh: () => Promise<unknown>;
  viewerId: Accessor<string | undefined>;
  isCurrent: () => boolean;
  initial: EmailSavedViewFilters;
  inboxes: readonly { id: string; label: string }[];
  onSaved: (record: SavedView) => void;
} & (
    | {
        mode: 'create';
        id: string;
        name: string;
        title?: string;
        submitLabel?: string;
        source: 'builder' | 'save_filters' | 'duplicate';
      }
    | { mode: 'edit'; record: SavedView }
  );

/** The view builder: the shared name dialog around the email conditions. */
function EmailSavedViewDialog(props: BuilderProps) {
  const { users } = useCombinedRecipients();
  const domainOptions = useEmailDomainSuggestions();
  const analytics = useAnalytics();
  const [filters, setFilters] = createSignal(props.initial);
  const config = () => configOf(filters());
  const fields = (
    <EmailSavedViewFields
      filters={filters()}
      onChange={setFilters}
      inboxes={props.inboxes}
      recipientOptions={users}
      domainOptions={domainOptions}
    />
  );
  const shared = {
    get open() {
      return props.open;
    },
    onOpenChange: props.onOpenChange,
    refresh: props.refresh,
    viewerId: props.viewerId,
    isCurrent: props.isCurrent,
    onSaved: props.onSaved,
    get invalid() {
      return decodeEmailSavedView(config()).isErr();
    },
  };
  if (props.mode === 'edit')
    return (
      <SavedViewDialog
        {...shared}
        mode="edit"
        record={props.record}
        config={config()}
        fields={fields}
      />
    );
  return (
    <SavedViewDialog
      {...shared}
      mode="create"
      id={props.id}
      name={props.name}
      config={config()}
      title={props.title}
      submitLabel={props.submitLabel}
      fields={fields}
      onSaved={(created) => {
        analytics.track('email_saved_view_created', {
          savedViewId: created.id,
          source: props.source,
        });
        props.onSaved(created);
      }}
    />
  );
}

type BuilderOpening =
  | {
      mode: 'create';
      filters: EmailSavedViewFilters;
      /** Started from the filters the list shows, rather than from nothing. */
      fromFilters?: boolean;
      copyOf?: SavedView;
    }
  | { mode: 'edit'; record: SavedView; filters: EmailSavedViewFilters };

function useOpenEmailSavedViewBuilder(owner: Owner | null = getOwner()) {
  const { savedViews, savedViewsList, selectSavedView, inboxOptions } =
    useEmailView();
  const captureRequest = useEmailSavedViewRequest();
  const viewerId = useUserId();
  return (opening: BuilderOpening): DialogHandle | undefined => {
    if (!savedViews || !savedViewsList) return;
    const request = captureRequest();
    const common = {
      refresh: savedViewsList.refresh,
      viewerId,
      isCurrent: request.isCurrent,
      initial: opening.filters,
      inboxes: inboxOptions(),
    };
    if (opening.mode === 'edit')
      return openDialog(
        EmailSavedViewDialog,
        () => ({
          ...common,
          mode: 'edit' as const,
          record: opening.record,
          // A confirmed edit of the open view becomes what it shows.
          onSaved: (updated: SavedView) => {
            if (request.isCurrent(updated.id)) savedViews.reset(updated);
          },
        }),
        { owner }
      );
    const copyOf = opening.copyOf;
    // The props accessor runs on every read; mint the id once.
    const id = uuid();
    return openDialog(
      EmailSavedViewDialog,
      () => ({
        ...common,
        mode: 'create' as const,
        id,
        name: copyOf
          ? `${copyOf.name.slice(0, 113)} (copy)`
          : t('viewMenus.newView'),
        title: copyOf ? t('emailViews.duplicateTitle') : undefined,
        submitLabel: copyOf ? t('emailViews.duplicate') : undefined,
        source: copyOf
          ? ('duplicate' as const)
          : opening.fromFilters
            ? ('save_filters' as const)
            : ('builder' as const),
        onSaved: (created: SavedView) => {
          if (request.isCurrent()) selectSavedView(created.id);
        },
      }),
      { owner }
    );
  };
}

/** Starts a view from what the list shows now, or from nothing. */
export function useCreateEmailSavedView(owner: Owner | null = getOwner()) {
  const { savedViews } = useEmailView();
  const open = useOpenEmailSavedViewBuilder(owner);
  return (options: { fromCurrent: boolean }) => {
    if (!savedViews) return;
    if (!options.fromCurrent)
      return open({ mode: 'create', filters: EMPTY_EMAIL_SAVED_VIEW_FILTERS });
    const captured = savedViews.capture();
    if (captured.isErr()) {
      toast.failure(captured.error);
      return;
    }
    return open({
      mode: 'create',
      filters: captured.value.filters,
      fromFilters: true,
    });
  };
}

async function copyEmailSavedViewLink(id: string) {
  const params = emailTabSearchCodec.serialize({
    tab: 'all',
    savedView: id,
  });
  if (!params) return;
  const url = new URL('/app/component/mail', window.location.origin);
  replacePaneSearchParams(url.searchParams, [
    { [emailTabSearch.namespace]: params },
  ]);
  if (await writeClipboardData({ 'text/plain': url.toString() }))
    toast.success(t('emailViews.linkCopied'));
  else toast.failure(t('emailViews.linkCopyFailed'));
}

function EmailSavedViewMenuItems(props: {
  record: SavedView;
  owner: Owner | null;
  defer: (action: () => void) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { savedViews, savedViewsList, savedViewScope, leaveSavedView } =
    useEmailView();
  const captureRequest = useEmailSavedViewRequest();
  const viewerId = useUserId();
  const open = useOpenEmailSavedViewBuilder(props.owner);
  // The open view's definition includes the edits made on top of it.
  const filtersFor = (record: SavedView) => {
    const view = savedViews?.view();
    if (view?.kind === 'saved' && view.record.id === record.id) {
      const current = savedViews?.capture();
      if (current?.isOk()) return current.value.filters;
    }
    return readEmailSavedView(record.config).config.filters;
  };
  const remove = () => {
    if (!savedViewsList) return;
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
      onEdit={() => {
        const record = props.record;
        props.defer(() =>
          open({ mode: 'edit', record, filters: filtersFor(record) })
        );
      }}
      onDuplicate={() => {
        const record = props.record;
        props.defer(() =>
          open({
            mode: 'create',
            filters: filtersFor(record),
            copyOf: record,
          })
        );
      }}
      onCopyLink={() =>
        fireAndForget(copyEmailSavedViewLink(props.record.id), 'saved-views')
      }
      onMoveUp={props.onMoveUp}
      onMoveDown={props.onMoveDown}
      onDelete={remove}
    />
  );
}

function UnreadDot() {
  return <span class="size-1.5 rounded-full bg-accent" />;
}

function EmailSavedViewRow(props: {
  record: SavedView;
  run: (action: () => void) => void;
  owner: Owner | null;
  reorder?: SavedViewRowReorder;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const { savedViews, savedViewsList, selectSavedView } = useEmailView();
  const viewerId = useUserId();
  const analytics = useAnalytics();
  const open = () => {
    analytics.track('email_saved_view_opened', {
      savedViewId: props.record.id,
      viewCount: savedViewsList?.items()?.length ?? 0,
    });
    selectSavedView(props.record.id);
  };
  const tagSets = useTagSets();
  const tagSetsReady = useTagSetsReady();
  const unread = useEmailSavedViewUnread({
    config: () => props.record.config,
    tagContext: () => createTagFacetContext(tagSets()),
    tagSetsReady,
  });
  const selected = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' && view.record.id === props.record.id;
  };
  return (
    <SavedViewListRow
      view={props.record}
      selected={selected()}
      scopeKey={viewerId()}
      onSelect={() => props.run(open)}
      trailing={
        <Show when={unread()}>
          <UnreadDot />
        </Show>
      }
      statusLabel={unread() ? t('emailViews.hasUnread') : undefined}
      reorder={props.reorder}
      menu={(defer) => (
        <EmailSavedViewMenuItems
          record={props.record}
          owner={props.owner}
          defer={(action) => defer(() => props.run(action))}
          onMoveUp={props.onMoveUp}
          onMoveDown={props.onMoveDown}
        />
      )}
    />
  );
}

/**
 * Loaded views in the viewer's order. A move shows at once and stays until
 * the list itself changes, which the confirmed reorder's refresh brings.
 */
function createEmailSavedViewOrder() {
  const { savedViewsList, savedViewScope } = useEmailView();
  const reorder = useReorderSavedViews({
    refresh: () => savedViewsList?.refresh() ?? Promise.resolve(),
  });
  const serverIds = () =>
    (savedViewsList?.items() ?? []).map((record) => record.id).join(',');
  const [pending, setPending] = createSignal<{
    order: string[];
    baseline: string;
  }>();
  const items = () => {
    const records = savedViewsList?.items() ?? [];
    const local = pending();
    if (!local || local.baseline !== serverIds()) return records;
    const position = new Map(local.order.map((id, index) => [id, index]));
    return [...records].sort(
      (left, right) =>
        (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
  };
  const save = async (order: string[]) => {
    const scope = savedViewScope();
    setPending({ order, baseline: serverIds() });
    const result = await reorder.mutateAsync({
      kind: EMAIL_SAVED_VIEW_KIND,
      ids: order,
    });
    if (!result.error || scope !== savedViewScope()) return;
    setPending(undefined);
    toast.failure(
      savedViewErrorMessage(result.error) ?? t('emailViews.reorderFailed')
    );
  };
  const move = (id: string, targetId: string, edge: InsertionEdge) => {
    if (id === targetId || reorder.isPending) return;
    const ids = items().map((record) => record.id);
    const without = ids.filter((value) => value !== id);
    const target = without.indexOf(targetId);
    if (target < 0) return;
    without.splice(edge === 'before' ? target : target + 1, 0, id);
    if (without.join(',') === ids.join(',')) return;
    fireAndForget(save(without), 'saved-views');
  };
  const step = (id: string, offset: -1 | 1) => {
    const ids = items().map((record) => record.id);
    const neighbour = ids[ids.indexOf(id) + offset];
    if (!neighbour) return undefined;
    return () => move(id, neighbour, offset < 0 ? 'before' : 'after');
  };
  return { items, move, step, busy: () => reorder.isPending };
}

function EmailSavedViewRows(props: {
  onAction?: (action: () => void) => void;
  dialogOwner?: Owner | null;
  /** Desktop rows drag to reorder; every list also moves through menus. */
  draggable?: boolean;
}) {
  const { savedViewsList } = useEmailView();
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-saved-view', true);
  const create = useCreateEmailSavedView(props.dialogOwner ?? getOwner());
  const owner = props.dialogOwner ?? getOwner();
  const order = createEmailSavedViewOrder();
  const [list, setList] = createSignal<HTMLElement>();
  const reorder = createVerticalReorder({
    order: () => order.items().map((record) => record.id),
    getViewport: list,
    enabled: () => !!props.draggable && order.items().length > 1,
    previewMarker: 'data-saved-view-drag-preview',
    onDrop: order.move,
  });
  const run = (action: () => void) =>
    props.onAction ? props.onAction(action) : action();
  const empty = () =>
    !savedViewsList?.loading() && savedViewsList?.items()?.length === 0;
  const rows = (draggable: boolean): JSX.Element => (
    <For each={order.items()}>
      {(record) => {
        const row = (reorderItem?: SavedViewRowReorder) => (
          <EmailSavedViewRow
            record={record}
            run={run}
            owner={owner}
            reorder={reorderItem}
            onMoveUp={order.step(record.id, -1)}
            onMoveDown={order.step(record.id, 1)}
          />
        );
        if (!draggable) return row();
        // Drag items need the provider, which only the desktop list mounts.
        return row(
          createReorderItem(record.id, {
            canDrag: () => order.items().length > 1 && !order.busy(),
            // Presses on the row's menu trigger never drag.
            ignore: '[aria-haspopup]',
            start: reorder.start,
          })
        );
      }}
    </For>
  );
  return (
    <Show when={savedViewsList}>
      {(views) => (
        <>
          <Show
            when={props.draggable}
            fallback={
              <SavedViewList.Items label={t('emailViews.savedEmailViews')}>
                {rows(false)}
              </SavedViewList.Items>
            }
          >
            <DragDropProvider
              collisionDetector={reorder.collisionDetector}
              onDragStart={reorder.onDragStart}
              onDragEnd={reorder.onDragEnd}
            >
              <DragSessionSensors
                getViewport={list}
                axis="both"
                activationDistance={4}
                onCancel={reorder.cancel}
              />
              <SavedViewList.Items
                ref={setList}
                label={t('emailViews.savedEmailViews')}
              >
                {rows(true)}
                <Show when={reorder.drop()}>
                  {(drop) => (
                    <VerticalInsertionLine drop={drop()} class="inset-x-0" />
                  )}
                </Show>
              </SavedViewList.Items>
              <DragOverlay
                class="pointer-events-none select-none rounded-md bg-panel shadow-md"
                style={{ 'z-index': 1000 }}
              >
                {reorder.preview()}
              </DragOverlay>
            </DragDropProvider>
          </Show>
          <Show when={views().loading() && !views().items()}>
            <p class="px-3 py-2 text-xs text-ink-muted" role="status">
              {t('emailViews.loadingViews')}
            </p>
          </Show>
          <Show when={empty()}>
            <div class="mx-2 my-1 flex flex-col items-start gap-2 rounded-lg border border-edge-muted p-3 group-data-closed/sidebar-section:invisible">
              <div class="space-y-1">
                <p class="text-xs font-medium text-ink">
                  {t('viewMenus.savedViewsEmptyTitle')}
                </p>
                <p class="text-xs text-ink-muted">
                  {t('emailViews.emptyDescription')}
                </p>
              </div>
              <Button
                ref={attachCreateHotkeys}
                size="sm"
                variant="secondary"
                onClick={() => run(() => create({ fromCurrent: false }))}
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
              {t('emailViews.retryLoading')}
            </Button>
          </Show>
          <Show when={views().hasMore()}>
            <Button
              size="sm"
              variant="ghost"
              disabled={views().loadingMore()}
              onClick={() => fireAndForget(views().loadMore(), 'saved-views')}
            >
              {t('emailViews.loadMore')}
            </Button>
          </Show>
        </>
      )}
    </Show>
  );
}

/** The desktop sidebar's Saved views section. */
export function EmailSavedViewsSection() {
  const {
    savedViewsEnabled,
    savedViewsList,
    isSidebarSectionOpen,
    setSidebarSectionOpen,
  } = useEmailView();
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-saved-view', true);
  const create = useCreateEmailSavedView();
  return (
    <Show when={savedViewsList && savedViewsEnabled()}>
      <SavedViewList.Root
        open={isSidebarSectionOpen(EMAIL_SAVED_VIEWS_SECTION_ID)}
        onOpenChange={(open) =>
          setSidebarSectionOpen(EMAIL_SAVED_VIEWS_SECTION_ID, open)
        }
      >
        <SavedViewList.Header
          onCreate={() => {
            setSidebarSectionOpen(EMAIL_SAVED_VIEWS_SECTION_ID, true);
            create({ fromCurrent: false });
          }}
          createButtonRef={attachCreateHotkeys}
        />
        <SavedViewList.Content>
          <EmailSavedViewRows draggable />
        </SavedViewList.Content>
      </SavedViewList.Root>
    </Show>
  );
}

/** The mobile pill after Filters; its drawer lists and manages views. */
export function EmailSavedViewsPicker() {
  const { savedViewsEnabled, savedViewsList, savedViewActive } = useEmailView();
  const viewerId = useUserId();
  const title = useEmailSavedViewTitle();
  // The drawer closes before its action opens a dialog; keep the outer owner.
  const owner = getOwner();
  return (
    <Show when={savedViewsList && savedViewsEnabled()}>
      <SavedViewPicker
        active={savedViewActive()}
        scopeKey={viewerId()}
        label={title() ?? t('viewMenus.savedViews')}
      >
        {(onAction) => (
          <EmailSavedViewRows onAction={onAction} dialogOwner={owner} />
        )}
      </SavedViewPicker>
    </Show>
  );
}

/** The open view's own menu, beside its name. */
export function EmailSavedViewMenu() {
  const { savedViews } = useEmailView();
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
            aria-label={t('emailViews.viewActions')}
            tooltip={t('emailViews.viewActions')}
          >
            <DotsIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-44" onCloseAutoFocus={finish}>
            <EmailSavedViewMenuItems
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

/** Whether the list shows filters a built-in tab could be saved with. */
function useCanSaveCurrentFilters() {
  const { state, savedViews, savedViewsEnabled, savedViewActive } =
    useEmailView();
  return () =>
    Boolean(savedViews) &&
    savedViewsEnabled() &&
    !savedViewActive() &&
    canSaveEmailTab(state.tab) &&
    (Object.values(state.facets).some((ids) => ids.length > 0) ||
      state.inboxIds !== undefined ||
      !!state.aliasFilter);
}

/** Desktop: left of Filters when the list's filters could become a view. */
export function EmailSaveViewButton() {
  const visible = useCanSaveCurrentFilters();
  const create = useCreateEmailSavedView();
  return (
    <Show when={visible()}>
      <Button variant="primary" onClick={() => create({ fromCurrent: true })}>
        {t('emailViews.saveView')}
      </Button>
    </Show>
  );
}

type DrawerDialogProps = {
  dialogOwner?: Owner | null;
  /** Lets a closing drawer open the dialog once it has gone. */
  onCreate?: (create: () => DialogHandle | undefined) => void;
};

/** Mobile: the filter drawer's banner above its footer. */
export function EmailSavedViewCreateBanner(props: DrawerDialogProps) {
  const visible = useCanSaveCurrentFilters();
  const create = useCreateEmailSavedView(props.dialogOwner ?? getOwner());
  const open = () => create({ fromCurrent: true });
  return (
    <Show when={visible()}>
      <div
        role="status"
        class="flex shrink-0 items-center gap-2 bg-accent-bg px-3 py-2 text-sm"
      >
        <InfoIcon class="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span class="min-w-0 flex-1">{t('emailViews.saveFiltersPrompt')}</span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => (props.onCreate ? props.onCreate(open) : open())}
        >
          <BookmarkIcon class="size-4" aria-hidden="true" />
          {t('emailViews.saveView')}
        </Button>
      </div>
    </Show>
  );
}

/** Save changes and Reset while the open view has edits; errors stay beside them. */
export function EmailSavedViewActions() {
  const { savedViews, savedViewsList } = useEmailView();
  const captureRequest = useEmailSavedViewRequest();
  const reload = useReloadEmailSavedView();
  const viewerId = useUserId();
  const create = useOpenEmailSavedViewBuilder();
  const update = useUpdateSavedView({
    refresh: () => savedViewsList?.refresh() ?? Promise.resolve(),
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
  const failure = () =>
    !update.isPending && selected()?.dirty && lastRequest?.isCurrent()
      ? update.error
      : null;
  return (
    <>
      <Show when={selected()?.dirty}>
        <HeaderActionGroup label={t('emailViews.viewActions')}>
          <Show when={selected()?.record.ownerId === viewerId()}>
            <ButtonGroup.Button
              variant="primary"
              class="touch:order-last"
              disabled={update.isPending || !!selected()?.issues.length}
              onClick={() => fireAndForget(save(), 'saved-views')}
            >
              {t('emailViews.saveChanges')}
            </ButtonGroup.Button>
          </Show>
          <ButtonGroup.Button
            variant="ghost"
            onClick={() => savedViews?.reset()}
          >
            {t('emailViews.reset')}
          </ButtonGroup.Button>
        </HeaderActionGroup>
      </Show>
      <Show when={failure()}>
        {(error) => (
          <HeaderActionGroup label={t('emailViews.saveError')}>
            <span
              role="alert"
              class="max-w-48 truncate text-xs text-failure-ink"
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
                {t('emailViews.reload')}
              </ButtonGroup.Button>
            </Show>
            <ButtonGroup.Button
              variant="ghost"
              onClick={() => {
                const view = selected();
                const current = savedViews?.capture();
                if (!view || !current?.isOk()) return;
                create({
                  mode: 'create',
                  filters: current.value.filters,
                  copyOf: view.record,
                });
              }}
            >
              {t('emailViews.duplicate')}
            </ButtonGroup.Button>
          </HeaderActionGroup>
        )}
      </Show>
    </>
  );
}

/** A missing or inaccessible view never falls back to unfiltered mail. */
export function EmailSavedViewUnavailable() {
  const { leaveSavedView } = useEmailView();
  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm touch:pt-(--mobile-content-inset-top)">
      <p role="alert">{t('emailViews.unavailable')}</p>
      <Button variant="ghost" onClick={leaveSavedView}>
        {t('emailViews.returnToEmail')}
      </Button>
    </div>
  );
}

const ISSUE_LABELS: Record<string, () => string> = {
  inboxIds: () => t('emailViews.inboxes'),
  importance: () => t('emailViews.importance'),
  participants: () => t('emailViews.people'),
  participantFields: () => t('emailViews.lookIn'),
  subject: () => t('emailViews.subjectContains'),
  receivedWithinDays: () => t('emailViews.received'),
  starred: () => t('emailViews.starred'),
  read: () => t('emailViews.status'),
  done: () => t('emailViews.done'),
  attachments: () => t('emailViews.attachments'),
  calendarInvite: () => t('emailViews.calendarInvite'),
  tags: () => t('emailViews.tags'),
};

/** Names what a newer definition holds that this version skipped. */
export function EmailSavedViewWarning() {
  const { savedViews } = useEmailView();
  const issues = () => {
    const view = savedViews?.view();
    return view?.kind === 'saved' ? view.issues : [];
  };
  const skipped = () =>
    [
      ...new Set(
        issues().map(({ path }) => {
          const field = path[0] === 'filters' ? path[1] : undefined;
          return field && ISSUE_LABELS[field]
            ? ISSUE_LABELS[field]()
            : (field ?? t('emailViews.viewDefinition'));
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
          <p class="font-medium">{t('emailViews.skippedTitle')}</p>
          <p class="break-words">
            {t('emailViews.skippedList', { settings: skipped() })}
          </p>
        </div>
      </div>
    </Show>
  );
}

import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, openDialog } from '@ui';
import { ok } from 'neverthrow';
import { For, getOwner, type Owner, Show } from 'solid-js';
import { v4 as uuid } from 'uuid';
import {
  SavedViewList,
  SavedViewListRow,
} from '../../saved-views/components/saved-view-list';
import { SavedViewMenuItems } from '../../saved-views/components/saved-view-menu';
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
import { useProjectSavedViews } from '../context/project-saved-views-context';
import {
  type ProjectSavedViewConfig,
  readProjectSavedView,
} from '../core/project-saved-view';

type ProjectViews = NonNullable<ReturnType<typeof useProjectSavedViews>>;

function ProjectViewSummary(props: {
  config: ProjectSavedViewConfig;
  omitted?: boolean;
}) {
  return (
    <div class="space-y-1 text-sm text-ink-muted">
      <Show when={props.omitted}>
        <p role="alert" class="text-failure">
          Unsupported settings will not be copied. The original view stays
          unchanged.
        </p>
      </Show>
      <p>
        Projects:{' '}
        {
          {
            all: 'All',
            'assigned-to-me': 'Assigned to me',
            'created-by-me': 'Created by me',
          }[props.config.scope]
        }
      </p>
      <p>
        Layout: {props.config.settings.layout === 'list' ? 'List' : 'Gantt'}
      </p>
      <p>Group by: {props.config.settings.groupBy}</p>
      <p>Sort: {props.config.settings.sort} (newest first)</p>
      <Show when={props.config.settings.status}>
        <p>Status filter applied</p>
      </Show>
      <Show when={props.config.settings.priority}>
        <p>Priority filter applied</p>
      </Show>
      <Show when={props.config.settings.mine}>
        <p>Assigned to me</p>
      </Show>
      <Show when={props.config.settings.dueAfter}>
        <p>Due from: {props.config.settings.dueAfter}</p>
      </Show>
      <Show when={props.config.settings.dueBefore}>
        <p>Due through: {props.config.settings.dueBefore}</p>
      </Show>
    </div>
  );
}

function createProjectViewDialogs(views: ProjectViews, owner = getOwner()) {
  const create = (record?: SavedView) => {
    const parsed = record ? readProjectSavedView(record.config) : undefined;
    const captured = parsed ? ok(parsed.config) : views.draft.capture();
    if (captured.isErr()) return toast.failure(captured.error);
    const config = captured.value;
    const id = uuid();
    const request = views.request();
    return openDialog(
      SavedViewDialog,
      () => ({
        mode: 'create' as const,
        id,
        name: record ? `${record.name.slice(0, 113)} (copy)` : 'New view',
        config,
        title: record ? 'Duplicate saved view' : 'Save view',
        submitLabel: record ? 'Duplicate' : 'Save view',
        summary: (
          <ProjectViewSummary
            config={config}
            omitted={Boolean(parsed?.issues.length)}
          />
        ),
        team: views.team(),
        viewerId: views.viewerId,
        refresh: views.list.refresh,
        isCurrent: request.isCurrent,
        onSaved: (created) => views.select(created.id),
      }),
      { owner }
    );
  };
  const edit = (record: SavedView) => {
    const request = views.request();
    return openDialog(
      SavedViewDialog,
      () => ({
        mode: 'edit' as const,
        record,
        team: views.team(),
        viewerId: views.viewerId,
        refresh: views.list.refresh,
        isCurrent: request.isCurrent,
        onSaved: (updated) => views.draft.acceptConfirmed(updated),
      }),
      { owner }
    );
  };
  const remove = (record: SavedView) => {
    const request = views.request();
    return openDialog(
      DeleteSavedViewDialog,
      () => ({
        record,
        viewerId: views.viewerId,
        refresh: views.list.refresh,
        isCurrent: request.isCurrent,
        description: 'Deleting this view does not delete its projects.',
        onDeleted: (deleted, viewer) => {
          if (viewer === views.viewerId() && deleted.id === views.selectedId())
            views.select();
        },
      }),
      { owner }
    );
  };
  return { create, edit, remove };
}

export function ProjectSavedViewRows(props: {
  onAction?: (action: () => void) => void;
  dialogOwner?: Owner | null;
  mobile?: boolean;
}) {
  const views = useProjectSavedViews();
  if (!views) return null;
  const dialogs = createProjectViewDialogs(
    views,
    props.dialogOwner ?? getOwner()
  );
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-project-view', true);
  const run = (action: () => void) =>
    props.onAction ? props.onAction(action) : action();
  const items = () => {
    const records = views.list.items();
    const selected = views.draft.view();
    if (
      selected.kind !== 'saved' ||
      selected.record.ownerId !== views.viewerId()
    )
      return records;
    if (records?.some((record) => record.id === selected.record.id))
      return records;
    return [selected.record, ...(records ?? [])];
  };
  return (
    <>
      <SavedViewList.Items label="Saved project views" mobile={props.mobile}>
        <Show when={views.creating()}>
          <SavedViewList.Draft
            mobile={props.mobile}
            onSelect={() => run(() => views.select())}
          />
        </Show>
        <For each={items()}>
          {(record) => (
            <SavedViewListRow
              view={record}
              mobile={props.mobile}
              selected={views.active() && views.selectedId() === record.id}
              scopeKey={views.viewerId()}
              onSelect={() => run(() => views.select(record.id))}
              menu={(defer) => (
                <SavedViewMenuItems
                  editLabel="Rename"
                  deleteLabel="Delete"
                  owned={record.ownerId === views.viewerId()}
                  onEdit={() =>
                    defer(() =>
                      run(() => {
                        dialogs.edit(record);
                      })
                    )
                  }
                  onDuplicate={() =>
                    defer(() =>
                      run(() => {
                        dialogs.create(record);
                      })
                    )
                  }
                  onDelete={() =>
                    defer(() =>
                      run(() => {
                        dialogs.remove(record);
                      })
                    )
                  }
                />
              )}
            />
          )}
        </For>
      </SavedViewList.Items>
      <Show when={views.list.loading() && !items()}>
        <p role="status" class="px-3 py-2 text-xs text-ink-muted">
          Loading views…
        </p>
      </Show>
      <Show
        when={
          !props.mobile &&
          !views.list.loading() &&
          items()?.length === 0 &&
          !views.creating()
        }
      >
        <div class="mx-2 my-1 flex flex-col items-start gap-2 rounded-lg border border-edge-muted p-3">
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
            variant="secondary"
            size="sm"
            onClick={() => run(views.start)}
          >
            <PlusIcon class="size-3.5" />
            {t('viewMenus.createSavedView')}
          </Button>
        </div>
      </Show>
      <Show when={views.list.error()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fireAndForget(views.list.refresh(), 'project-views')}
        >
          Retry loading views
        </Button>
      </Show>
      <Show when={views.list.hasMore()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={views.list.loadingMore()}
          onClick={() => fireAndForget(views.list.loadMore(), 'project-views')}
        >
          Load more views
        </Button>
      </Show>
    </>
  );
}

export function ProjectSavedViewActions() {
  const views = useProjectSavedViews();
  if (!views) return null;
  const dialogs = createProjectViewDialogs(views);
  const update = useUpdateSavedView({ refresh: views.list.refresh });
  const selected = () => {
    const view = views.draft.view();
    return view.kind === 'saved' ? view : undefined;
  };
  const canSave = () => {
    const view = views.draft.view();
    return view.kind === 'new' || (view.kind === 'default' && view.changed);
  };
  const save = async () => {
    const view = selected();
    if (!view || view.issues.length || update.isPending) return;
    const config = views.draft.capture();
    if (config.isErr()) return toast.failure(config.error);
    const request = views.request();
    const release = views.draft.retain();
    try {
      const result = await update.mutateAsync({
        id: view.record.id,
        name: view.record.name,
        config: config.value,
        expectedRevision: view.record.revision,
      });
      if (!request.isCurrent()) return;
      if (result.error)
        return toast.failure(
          savedViewErrorMessage(result.error) ?? 'Could not save view'
        );
      if (result.data?.updateSavedView)
        views.draft.acceptConfirmed(toSavedView(result.data.updateSavedView));
    } finally {
      release();
    }
  };
  return (
    <>
      <Show when={canSave()}>
        <Button
          variant="primary"
          onClick={() => {
            dialogs.create();
          }}
        >
          Save view
        </Button>
        <Show when={views.creating()}>
          <Button variant="ghost" onClick={() => views.select()}>
            Cancel
          </Button>
        </Show>
      </Show>
      <Show when={selected()?.dirty}>
        <Show when={selected()?.record.ownerId === views.viewerId()}>
          <Button
            variant="primary"
            disabled={update.isPending || Boolean(selected()?.issues.length)}
            onClick={() => fireAndForget(save(), 'project-views')}
          >
            Save changes
          </Button>
        </Show>
        <Button
          variant="ghost"
          disabled={update.isPending}
          onClick={() => views.draft.reset()}
        >
          Reset
        </Button>
      </Show>
    </>
  );
}

export function ProjectSavedViewStatus() {
  const views = useProjectSavedViews();
  if (!views) return null;
  const message = () => {
    const view = views.draft.view();
    if (view.kind === 'unavailable') return view.message;
    if (view.kind === 'saved' && view.issues.length)
      return 'This project view contains unsupported settings. Its original definition is unchanged.';
  };
  return (
    <Show when={message()}>
      {(message) => (
        <p
          role="alert"
          class="mx-3 my-2 rounded-lg border border-failure p-3 text-sm text-failure"
        >
          {message()}
        </p>
      )}
    </Show>
  );
}

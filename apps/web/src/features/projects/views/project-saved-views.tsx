import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Button, openDialog } from '@ui';
import { ok } from 'neverthrow';
import { getOwner, Show } from 'solid-js';
import { SavedViewCreateButton } from '../../saved-views/components/saved-view-create-button';
import {
  SavedViewList,
  SavedViewListEntries,
  SavedViewListRow,
} from '../../saved-views/components/saved-view-list';
import { SavedViewMenuItems } from '../../saved-views/components/saved-view-menu';
import type { SavedView } from '../../saved-views/core/saved-view';
import {
  savedViewErrorMessage,
  useUpdateSavedView,
} from '../../saved-views/queries/saved-view-actions';
import { toSavedView } from '../../saved-views/queries/saved-views';
import { SavedViewAppearanceMenu } from '../../saved-views/saved-view-appearance';
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
          {t('viewMenus.unsupportedCopy')}
        </p>
      </Show>
      <p>
        {t('viewMenus.projectScopeSummary', {
          scope: {
            all: t('viewMenus.all'),
            'assigned-to-me': t('viewMenus.assignedToMe'),
          }[props.config.scope],
        })}
      </p>
      <p>
        {t('viewMenus.projectLayoutSummary', {
          layout:
            props.config.settings.layout === 'list'
              ? t('viewMenus.layoutList')
              : t('viewMenus.layoutGantt'),
        })}
      </p>
      <p>
        {t('viewMenus.projectGroupSummary', {
          group: {
            none: t('viewMenus.groupNone'),
            status: t('viewMenus.status'),
            priority: t('viewMenus.priority'),
            assignee: t('viewMenus.assignee'),
          }[props.config.settings.groupBy],
        })}
      </p>
      <p>
        {t('viewMenus.projectSortSummary', {
          sort:
            props.config.settings.sort === 'updated'
              ? t('viewMenus.updated')
              : t('viewMenus.created'),
        })}
      </p>
      <Show when={props.config.settings.status}>
        <p>{t('viewMenus.statusFilterApplied')}</p>
      </Show>
      <Show when={props.config.settings.priority}>
        <p>{t('viewMenus.priorityFilterApplied')}</p>
      </Show>
      <Show when={props.config.settings.mine}>
        <p>{t('viewMenus.assignedToMe')}</p>
      </Show>
      <Show when={props.config.settings.dueAfter}>
        <p>
          {t('viewMenus.dueFromSummary', {
            date: props.config.settings.dueAfter,
          })}
        </p>
      </Show>
      <Show when={props.config.settings.dueBefore}>
        <p>
          {t('viewMenus.dueThroughSummary', {
            date: props.config.settings.dueBefore,
          })}
        </p>
      </Show>
    </div>
  );
}

function createProjectViewDialogs(views: ProjectViews, owner = getOwner()) {
  const open = () => {
    const draft = views.creation.current();
    if (!draft) return;
    const request = views.request();
    return openDialog(
      SavedViewDialog,
      () => ({
        mode: 'create' as const,
        id: draft.id,
        existing: views.creation.persisted(),
        name: draft.name,
        sharedTeamId: draft.sharedTeamId,
        appearance: draft.appearance,
        config: views.draft.capture().unwrapOr(draft.config),
        title: t('viewMenus.saveView'),
        submitLabel: t('viewMenus.saveView'),
        summary: (
          <ProjectViewSummary
            config={readProjectSavedView(draft.config).config}
          />
        ),
        team: views.team(),
        viewerId: views.viewerId,
        refresh: views.list.refresh,
        isCurrent: () =>
          request.isCurrent() && views.creation.current()?.id === draft.id,
        onChange: (fields: { name: string; sharedTeamId: string | null }) =>
          views.creation.update(fields),
        onSaved: (created) => {
          if (views.creation.confirm(created)) views.selectCreated(created.id);
        },
      }),
      { owner }
    );
  };
  const create = (record?: SavedView) => {
    if (!record && views.creation.current()) return open();
    const captured = record
      ? ok(readProjectSavedView(record.config).config)
      : views.draft.capture();
    if (captured.isErr()) return toast.failure(captured.error);
    const name = record
      ? t('viewMenus.copyName', { name: record.name.slice(0, 113) })
      : t('viewMenus.newView');
    let handle: ReturnType<typeof open>;
    views.start(
      captured.value,
      name,
      () => {
        handle = open();
      },
      true,
      record?.appearance
    );
    return handle;
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
        description: t('viewMenus.deleteProjectViewDescription'),
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

export function ProjectSavedViewsList() {
  const views = useProjectSavedViews();
  if (!views) return null;
  const dialogs = createProjectViewDialogs(views);
  const [attachCreateHotkeys] = useHotkeyDOMScope('create-project-view', true);
  const items = views.creation.items;
  return (
    <>
      <SavedViewList.Items label={t('viewMenus.savedProjectViews')}>
        <SavedViewListEntries
          entries={views.creation.entries()}
          onDraftSelect={() => {}}
        >
          {(record) => (
            <SavedViewListRow
              view={record()}
              touchActions={isTouchDevice()}
              selected={views.active() && views.selectedId() === record().id}
              scopeKey={views.viewerId()}
              onSelect={() => views.select(record().id)}
              menu={(defer) => (
                <SavedViewMenuItems
                  mobile={isTouchDevice()}
                  editLabel={t('viewMenus.editView')}
                  deleteLabel={t('common.delete')}
                  owned={record().ownerId === views.viewerId()}
                  appearance={
                    <SavedViewAppearanceMenu view={record()} defer={defer} />
                  }
                  onEdit={() => defer(() => dialogs.edit(record()))}
                  onDuplicate={() => defer(() => dialogs.create(record()))}
                  onDelete={() => defer(() => dialogs.remove(record()))}
                />
              )}
            />
          )}
        </SavedViewListEntries>
      </SavedViewList.Items>
      <Show when={views.list.loading() && !items()}>
        <p role="status" class="px-3 py-2 text-xs text-ink-muted">
          {t('viewMenus.loadingViews')}
        </p>
      </Show>
      <Show when={views.list.error()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fireAndForget(views.list.refresh(), 'project-views')}
        >
          {t('viewMenus.retryLoadingViews')}
        </Button>
      </Show>
      <Show when={views.list.hasMore()}>
        <Button
          variant="ghost"
          size="sm"
          disabled={views.list.loadingMore()}
          onClick={() => fireAndForget(views.list.loadMore(), 'project-views')}
        >
          {t('viewMenus.loadMoreViews')}
        </Button>
      </Show>
      <SavedViewCreateButton
        ref={attachCreateHotkeys}
        onCreate={() => views.start()}
      />
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
          savedViewErrorMessage(result.error) ?? t('viewMenus.saveViewFailed')
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
          {t('viewMenus.saveView')}
        </Button>
        <Show when={views.creating()}>
          <Button variant="ghost" onClick={() => views.select()}>
            {t('common.cancel')}
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
            {t('viewMenus.saveChanges')}
          </Button>
        </Show>
        <Button
          variant="ghost"
          disabled={update.isPending}
          onClick={() => views.draft.reset()}
        >
          {t('viewMenus.reset')}
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
      return t('viewMenus.unsupportedProjectView');
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

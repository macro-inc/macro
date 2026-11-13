import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { fireAndForget } from '@core/util/fireAndForget';
import NotionIcon from '@icon/mcp-notion.svg';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import { Telemetry } from '@macro-inc/observability';
import type { DatabaseSync } from '@service-cognition/generated/schemas/databaseSync';
import type { DatabaseSyncFailure } from '@service-cognition/generated/schemas/databaseSyncFailure';
import type { DatabaseSyncSource } from '@service-cognition/generated/schemas/databaseSyncSource';
import type { DatabaseSyncSources } from '@service-cognition/generated/schemas/databaseSyncSources';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { createSignal, For, Match, onCleanup, Show, Switch } from 'solid-js';
import { match, P } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import { toViewColumn } from '../../database/queries/column-detail';
import {
  GRANOLA_APP_SLUG,
  GRANOLA_ICON_URL,
} from '../../granola-connect/core/granola';
import { formatTimeAgo, syncSourceKey } from '../core/database-syncs';
import {
  createTableSync,
  deleteTableSync,
  runTableSync,
  useDatabaseSyncSources,
  useDatabaseSyncs,
} from '../queries/database-syncs';
import { SyncSourceOptions } from './SyncSourceOptions';

function failureMessage(failure: DatabaseSyncFailure): string {
  return match(failure)
    .with('source_disconnected', () =>
      t('databaseSyncs.failureSourceDisconnected')
    )
    .with('source_not_found', () => t('databaseSyncs.failureSourceNotFound'))
    .with('source_unavailable', () =>
      t('databaseSyncs.failureSourceUnavailable')
    )
    .with('creator_lost_access', () =>
      t('databaseSyncs.failureCreatorLostAccess')
    )
    .with('database_unavailable', () =>
      t('databaseSyncs.failureDatabaseUnavailable')
    )
    .with('internal', () => t('databaseSyncs.failureInternal'))
    .exhaustive();
}

/** The tables of a database kept in sync with Granola or Notion: list them, run them, add one. */
export function SyncDialog(props: {
  detail: DatabaseDetail;
  /** Show a table the dialog just added. */
  onTableAdded: (tableId: string) => void;
  onClose: () => void;
  returnFocus?: HTMLElement;
}) {
  const databaseId = () => props.detail.database.id;
  const syncs = useDatabaseSyncs(databaseId);
  const sources = useDatabaseSyncSources();
  const { openSettings } = useSettingsState();
  const [pendingKey, setPendingKey] = createSignal<string>();
  /** One id per source until its create succeeds, so a retry answers the first attempt. */
  const attemptIds: Record<string, string> = {};
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const loadedSyncs = () => (syncs.isPending ? [] : (syncs.data ?? []));
  const loadedSources = () => (sources.isPending ? undefined : sources.data);
  const syncedKeys = () =>
    loadedSyncs().map((sync) => syncSourceKey(sync.source));

  function openConnections() {
    props.onClose();
    openSettings('Connected');
  }

  async function create(source: DatabaseSyncSource) {
    if (pendingKey()) return;
    const key = syncSourceKey(source);
    attemptIds[key] ??= uuidv7();
    const id = attemptIds[key];
    const forDatabase = databaseId();
    setPendingKey(key);
    const result = await Telemetry.span(
      'database.sync.create',
      async (span) => {
        span.setAttr('database.id', forDatabase);
        span.setAttr('database_sync.id', id);
        span.setAttr('database_sync.source', source.kind);
        const created = await createTableSync(forDatabase, id, source);
        if (created.isErr()) span.error('Could not create a synced table');
        return created;
      }
    );
    if (disposed) return;
    setPendingKey(undefined);
    if (result.isErr()) {
      toast.failure(t('databaseSyncs.createFailed'));
      return;
    }
    delete attemptIds[key];
    if (databaseId() === forDatabase) props.onTableAdded(result.value.tableId);
  }

  return (
    <Dialog
      open
      class="w-160 max-w-[calc(100vw-2rem)]"
      onOpenChange={(open) => !open && !pendingKey() && props.onClose()}
      onCloseAutoFocus={(event) => {
        if (props.returnFocus?.isConnected) {
          event.preventDefault();
          props.returnFocus.focus();
        }
      }}
    >
      <Panel>
        <Panel.Body>
          <div class="flex min-w-0 flex-col gap-4 p-5">
            <div>
              <Dialog.Title class="text-base font-semibold">
                {t('databaseSyncs.dialogTitle')}
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                {t('databaseSyncs.dialogDescription')}
              </Dialog.Description>
            </div>
            <Switch>
              <Match when={syncs.isPending}>
                <div class="flex justify-center py-3">
                  <LoadingSpinner />
                </div>
              </Match>
              <Match when={syncs.isError && loadedSyncs().length === 0}>
                <p class="text-sm text-failure" role="alert">
                  {t('databaseSyncs.loadFailed')}
                </p>
              </Match>
              <Match when={loadedSyncs().length === 0}>
                <p class="text-sm text-ink-muted">{t('databaseSyncs.empty')}</p>
              </Match>
              <Match when={loadedSyncs().length > 0}>
                <ul class="flex flex-col divide-y divide-edge-muted rounded-md border border-edge-muted text-sm">
                  <For each={loadedSyncs()}>
                    {(sync) => (
                      <SyncRow
                        sync={sync}
                        detail={props.detail}
                        sources={loadedSources()}
                      />
                    )}
                  </For>
                </ul>
              </Match>
            </Switch>
            <section class="flex flex-col gap-2">
              <h3 class="text-sm font-medium">{t('databaseSyncs.addTable')}</h3>
              <Switch>
                <Match when={sources.isPending}>
                  <div class="flex justify-center py-3">
                    <LoadingSpinner />
                  </div>
                </Match>
                <Match when={sources.isError && !loadedSources()}>
                  <p class="text-sm text-failure" role="alert">
                    {t('databaseSyncs.sourcesFailed')}
                  </p>
                </Match>
                <Match when={loadedSources()}>
                  {(loaded) => (
                    <SyncSourceOptions
                      sources={loaded()}
                      syncedKeys={syncedKeys()}
                      pendingKey={pendingKey()}
                      onChoose={(source) =>
                        fireAndForget(create(source), 'database-syncs')
                      }
                      onOpenConnections={openConnections}
                    />
                  )}
                </Match>
              </Switch>
            </section>
            <div class="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={pendingKey() !== undefined}
                onClick={props.onClose}
              >
                {t('databaseSyncs.done')}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function SyncRow(props: {
  sync: DatabaseSync;
  detail: DatabaseDetail;
  sources: DatabaseSyncSources | undefined;
}) {
  const [busy, setBusy] = createSignal(false);
  const databaseId = () => props.sync.databaseId;
  const tableName = () => syncedTable()?.table.name;
  const sourceLabel = () =>
    match(props.sync.source)
      .with({ kind: 'granola_meetings' }, () =>
        t('databaseSyncs.granolaMeetings')
      )
      .with(
        { kind: 'notion_data_source' },
        (notion) =>
          props.sources?.notion.dataSources.find(
            (dataSource) => dataSource.id === notion.dataSourceId
          )?.title ?? t('databaseSyncs.notionDatabase')
      )
      .exhaustive();
  const syncedTable = () =>
    props.detail.tables.find((table) => table.table.id === props.sync.tableId);
  /** Detached columns still in the table; a deleted one needs no note. */
  const detachedNames = () => {
    const columns = (syncedTable()?.columns ?? []).map(toViewColumn);
    return props.sync.detachedColumns
      .map(
        (detached) =>
          columns.find((column) => column.id === detached.column)?.name
      )
      .filter((name): name is string => name !== undefined);
  };

  const failure = () =>
    match(props.sync.status)
      .with({ state: 'failed' }, (failed) => failed.failure)
      .with({ state: P.union('pending', 'synced') }, () => undefined)
      .exhaustive();

  async function runNow() {
    setBusy(true);
    const result = await Telemetry.span('database.sync.run', async (span) => {
      span.setAttr('database.id', databaseId());
      span.setAttr('database_sync.id', props.sync.id);
      const ran = await runTableSync(databaseId(), props.sync.id);
      if (ran.isErr()) span.error('Could not start a sync');
      return ran;
    });
    setBusy(false);
    result.match(
      () => toast.success(t('databaseSyncs.syncRequested')),
      () => toast.failure(t('databaseSyncs.syncNowFailed'))
    );
  }

  async function stop() {
    setBusy(true);
    const result = await Telemetry.span(
      'database.sync.delete',
      async (span) => {
        span.setAttr('database.id', databaseId());
        span.setAttr('database_sync.id', props.sync.id);
        const deleted = await deleteTableSync(databaseId(), props.sync.id);
        if (deleted.isErr()) span.error('Could not stop a sync');
        return deleted;
      }
    );
    setBusy(false);
    if (result.isErr()) toast.failure(t('databaseSyncs.stopSyncingFailed'));
  }

  return (
    <li class="flex flex-col gap-2 px-3 py-2.5">
      <div class="flex items-start gap-3">
        <span class="flex size-5 shrink-0 items-center justify-center pt-0.5">
          {match(props.sync.source.kind)
            .with('granola_meetings', () => (
              <PipedreamConnectorIcon
                appSlug={GRANOLA_APP_SLUG}
                iconUrl={GRANOLA_ICON_URL}
                class="size-5"
              />
            ))
            .with('notion_data_source', () => <NotionIcon class="size-5" />)
            .exhaustive()}
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate font-medium">{sourceLabel()}</span>
          <span class="truncate text-xs text-ink-muted">
            <Show when={tableName()} fallback={t('databaseSyncs.tableRemoved')}>
              {(name) => t('databaseSyncs.syncsInto', { table: name() })}
            </Show>
          </span>
          <SyncStatus sync={props.sync} />
        </div>
      </div>
      <Show when={failure()}>
        {(reason) => (
          <p class="pl-8 text-xs text-failure-ink" role="alert">
            {failureMessage(reason())}
          </p>
        )}
      </Show>
      <Show when={detachedNames().length > 0}>
        <p class="pl-8 text-xs text-ink-muted">
          {t('databaseSyncs.detachedColumns', {
            count: detachedNames().length,
            columns: detachedNames().join(', '),
          })}
        </p>
      </Show>
      <div class="flex flex-wrap justify-end gap-2 pl-8">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy()}
          onClick={() => fireAndForget(runNow(), 'database-syncs')}
        >
          <ArrowsClockwiseIcon class="size-3.5" />
          {t('databaseSyncs.syncNow')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy()}
          tooltip={t('databaseSyncs.stopSyncingHint')}
          onClick={() => fireAndForget(stop(), 'database-syncs')}
        >
          {t('databaseSyncs.stopSyncing')}
        </Button>
      </div>
    </li>
  );
}

function SyncStatus(props: { sync: DatabaseSync }) {
  const lastSynced = () => {
    const at = props.sync.lastSyncedAt;
    if (at === null) return t('databaseSyncs.neverSynced');
    return t('databaseSyncs.lastSynced', {
      time: formatTimeAgo(new Date(at), new Date()),
    });
  };
  const state = () =>
    match(props.sync.status)
      .with({ state: 'pending' }, () => ({
        label: t('databaseSyncs.statusPending'),
        tone: 'text-ink-muted',
      }))
      .with({ state: 'synced' }, () => ({
        label: t('databaseSyncs.statusSynced'),
        tone: 'text-success-ink',
      }))
      .with({ state: 'failed' }, () => ({
        label: t('databaseSyncs.statusFailed'),
        tone: 'text-failure-ink',
      }))
      .exhaustive();

  return (
    <span class="text-xs">
      <span class={state().tone}>{state().label}</span>
      <span class="text-ink-muted"> · {lastSynced()}</span>
    </span>
  );
}

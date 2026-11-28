import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { useSettingsState } from '@core/constant/SettingsState';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import type { DatabaseSyncSource } from '@service-cognition/generated/schemas/databaseSyncSource';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import type { ManagedDialogProps } from '@ui/components/ImperativeDialog';
import { Panel } from '@ui/components/Panel';
import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import { v7 as uuidv7 } from 'uuid';
import { SyncSourceOptions } from '../component/SyncSourceOptions';
import { syncSourceKey } from '../core/database-syncs';
import {
  createSyncedDatabase,
  useDatabaseSyncSources,
} from '../queries/database-syncs';

/** Pick a source and create a database whose table mirrors it. */
export function SyncedDatabaseDialog(
  props: ManagedDialogProps & {
    /** UI surface the creation came from, for analytics. */
    createdFrom: string;
    onCreated: (databaseId: string) => void;
  }
) {
  const sources = useDatabaseSyncSources();
  const { openSettings } = useSettingsState();
  const [pendingKey, setPendingKey] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  /** One id per source until its create succeeds, so a retry answers the first attempt. */
  const attemptIds: Record<string, string> = {};
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const loadedSources = () => (sources.isPending ? undefined : sources.data);

  function openConnections() {
    props.onOpenChange(false);
    openSettings('Connected');
  }

  async function create(source: DatabaseSyncSource) {
    if (pendingKey()) return;
    const key = syncSourceKey(source);
    attemptIds[key] ??= uuidv7();
    const id = attemptIds[key];
    setPendingKey(key);
    setFailed(false);
    const result = await Telemetry.span(
      'database.sync.create_database',
      async (span) => {
        span.setAttr('database_sync.id', id);
        span.setAttr('database_sync.source', source.kind);
        const created = await createSyncedDatabase(
          id,
          source,
          props.createdFrom
        );
        if (created.isErr()) span.error('Could not create a synced database');
        else span.setAttr('database.id', created.value.databaseId);
        return created;
      }
    );
    if (disposed) return;
    setPendingKey(undefined);
    if (result.isErr()) {
      setFailed(true);
      return;
    }
    props.onOpenChange(false);
    props.onCreated(result.value.databaseId);
  }

  return (
    <Dialog
      open={props.open}
      class="w-120 max-w-[calc(100vw-2rem)]"
      onOpenChange={(open) =>
        !open && !pendingKey() && props.onOpenChange(false)
      }
    >
      <Panel>
        <Panel.Body>
          <div class="flex min-w-0 flex-col gap-4 p-5">
            <div>
              <Dialog.Title class="text-base font-semibold">
                {t('databaseSyncs.pickerTitle')}
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                {t('databaseSyncs.pickerDescription')}
              </Dialog.Description>
            </div>
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
                    syncedKeys={[]}
                    pendingKey={pendingKey()}
                    onChoose={(source) =>
                      fireAndForget(create(source), 'synced-database')
                    }
                    onOpenConnections={openConnections}
                  />
                )}
              </Match>
            </Switch>
            <Show when={failed()}>
              <p class="text-sm text-failure" role="alert">
                {t('databaseSyncs.createDatabaseFailed')}
              </p>
            </Show>
            <div class="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                disabled={pendingKey() !== undefined}
                onClick={() => props.onOpenChange(false)}
              >
                {t('databaseSyncs.cancel')}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

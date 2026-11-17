import { t } from '@app/lib/i18n';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import NotionIcon from '@icon/mcp-notion.svg';
import type { DatabaseSyncSource } from '@service-cognition/generated/schemas/databaseSyncSource';
import type { DatabaseSyncSources } from '@service-cognition/generated/schemas/databaseSyncSources';
import { Button } from '@ui/components/Button';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  GRANOLA_APP_SLUG,
  GRANOLA_ICON_URL,
} from '../../granola-connect/core/granola';
import { syncSourceKey } from '../core/database-syncs';

type SyncSourceOptionsProps = {
  sources: DatabaseSyncSources;
  /** Keys (`syncSourceKey`) of the sources this database already mirrors. */
  syncedKeys: string[];
  /** Key of the source being created, if any; every choice waits for it. */
  pendingKey?: string;
  onChoose: (source: DatabaseSyncSource) => void;
  onOpenConnections: () => void;
};

/** Granola meetings and the viewer's Notion databases, each offered for syncing. */
export function SyncSourceOptions(props: SyncSourceOptionsProps) {
  const granola: DatabaseSyncSource = { kind: 'granola_meetings' };

  return (
    <ul class="flex flex-col divide-y divide-edge-muted rounded-md border border-edge-muted text-sm">
      <li class="flex flex-col gap-2 px-3 py-2.5">
        <SourceHeading
          icon={
            <PipedreamConnectorIcon
              appSlug={GRANOLA_APP_SLUG}
              iconUrl={GRANOLA_ICON_URL}
              class="size-5"
            />
          }
          title={t('databaseSyncs.granolaMeetings')}
          description={t('databaseSyncs.sourceGranolaDescription')}
          action={
            <Show when={props.sources.granola.connected}>
              <ChooseButton
                source={granola}
                syncedKeys={props.syncedKeys}
                pendingKey={props.pendingKey}
                onChoose={props.onChoose}
              />
            </Show>
          }
        />
        <Show when={!props.sources.granola.connected}>
          <ConnectHint onOpenConnections={props.onOpenConnections}>
            {t('databaseSyncs.granolaNotConnected')}
          </ConnectHint>
        </Show>
      </li>
      <li class="flex flex-col gap-2 px-3 py-2.5">
        <SourceHeading
          icon={<NotionIcon class="size-5" />}
          title={t('databaseSyncs.notionDatabase')}
          description={t('databaseSyncs.sourceNotionDescription')}
        />
        <Switch
          fallback={
            <ul class="ml-8 flex max-h-60 flex-col overflow-y-auto">
              <For each={props.sources.notion.dataSources}>
                {(dataSource) => (
                  <li class="flex min-h-9 items-center gap-3 touch:min-h-[44px]">
                    <span class="min-w-0 flex-1 truncate">
                      {dataSource.title}
                    </span>
                    <ChooseButton
                      source={{
                        kind: 'notion_data_source',
                        dataSourceId: dataSource.id,
                      }}
                      syncedKeys={props.syncedKeys}
                      pendingKey={props.pendingKey}
                      onChoose={props.onChoose}
                    />
                  </li>
                )}
              </For>
            </ul>
          }
        >
          <Match when={!props.sources.notion.connected}>
            <ConnectHint onOpenConnections={props.onOpenConnections}>
              {t('databaseSyncs.notionNotConnected')}
            </ConnectHint>
          </Match>
          <Match when={props.sources.notion.dataSources.length === 0}>
            <p class="pl-8 text-xs text-ink-muted">
              {t('databaseSyncs.notionNoDatabases')}
            </p>
          </Match>
        </Switch>
      </li>
    </ul>
  );
}

function SourceHeading(props: {
  icon: JSX.Element;
  title: string;
  description: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex items-center gap-3">
      <span class="flex size-5 shrink-0 items-center justify-center">
        {props.icon}
      </span>
      <div class="min-w-0 flex-1">
        <div class="font-medium">{props.title}</div>
        <div class="text-xs text-ink-muted">{props.description}</div>
      </div>
      {props.action}
    </div>
  );
}

function ConnectHint(props: {
  children: JSX.Element;
  onOpenConnections: () => void;
}) {
  return (
    <p class="pl-8 text-xs text-ink-muted">
      {props.children}{' '}
      <Button
        type="button"
        variant="link"
        size="xs"
        onClick={props.onOpenConnections}
      >
        {t('databaseSyncs.openIntegrations')}
      </Button>
    </p>
  );
}

function ChooseButton(props: {
  source: DatabaseSyncSource;
  syncedKeys: string[];
  pendingKey?: string;
  onChoose: (source: DatabaseSyncSource) => void;
}) {
  const key = () => syncSourceKey(props.source);
  const synced = () => props.syncedKeys.includes(key());

  return (
    <Show
      when={!synced()}
      fallback={
        <span class="shrink-0 text-xs text-ink-muted">
          {t('databaseSyncs.alreadySynced')}
        </span>
      }
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={props.pendingKey !== undefined}
        onClick={() => props.onChoose(props.source)}
      >
        {props.pendingKey === key()
          ? t('databaseSyncs.creating')
          : t('databaseSyncs.sync')}
      </Button>
    </Show>
  );
}

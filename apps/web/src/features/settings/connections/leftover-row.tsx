import { toast } from '@core/component/Toast/Toast';
import { ConnectedAppIcon } from '@core/connectors/ConnectedAppIcon';
import { createConnectAction } from '@core/connectors/connect-action';
import { fireAndForget } from '@core/util/fireAndForget';
import PlugIcon from '@icon/system/regular/plug.svg';
import {
  useRemoveConnectorMutation,
  useUpdateConnectorMutation,
} from '@queries/connectors';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, type JSX } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction } from '../integration-ui';
import {
  type ConnectionMenuItem,
  ConnectionRowActions,
} from './connection-more';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import {
  IntegrationListRow,
  type IntegrationStatus,
} from './integrations-list';
import type { Leftover } from './model';

/** Apps read as agent tools; servers added by URL are custom. */
export function leftoverCategories(leftover: Leftover): string[] {
  return leftover.kind === 'server' ? ['Custom MCP'] : ['Agent tools'];
}

const AGENT_APP_DESCRIPTION =
  'Agents can use this app when you ask them to. Nothing is copied into Macro.';

export function LeftoverRow(props: { leftover: Leftover }) {
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const [renaming, setRenaming] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const update = useUpdateConnectorMutation();
  const removal = useRemoveConnectorMutation();
  const { connect, busy: connectBusy } = createConnectAction({
    key: () => props.leftover.key,
    name: () => props.leftover.title,
  });

  const busy = () => update.isPending || removal.isPending || connectBusy();
  const failureNoun = () =>
    props.leftover.kind === 'server' ? 'server' : 'connector';

  const setEnabled = (enabled: boolean) =>
    update.mutate(
      { key: props.leftover.key, enabled },
      { onError: () => toast.failure(`Failed to update ${failureNoun()}`) }
    );

  const remove = (connected: boolean) =>
    removal.mutate(
      { key: props.leftover.key },
      {
        onSuccess: () =>
          toast.success(connected ? 'Disconnected from Macro' : 'Removed'),
        onError: () =>
          toast.failure(
            connected ? 'Failed to disconnect' : 'Failed to remove'
          ),
      }
    );

  const startConnect = () => fireAndForget(connect(), 'connections-settings');

  const askRemove = (connected: boolean) =>
    setDisconnect({
      title: connected ? 'Disconnect from Macro' : 'Remove',
      body: connected
        ? `Disconnect ${props.leftover.title}?`
        : `Remove ${props.leftover.title}?`,
      confirmLabel: connected ? 'Disconnect' : 'Remove',
      onConfirm: () => remove(connected),
    });

  const openRename = () => {
    setNameDraft(props.leftover.title);
    setRenaming(true);
  };

  const saveRename = () => {
    const name = nameDraft().trim();
    if (!name) return;
    update.mutate(
      { key: props.leftover.key, name },
      {
        onSuccess: () => setRenaming(false),
        onError: () => toast.failure('Failed to update server'),
      }
    );
  };

  const disconnectItem = (connected = true): ConnectionMenuItem => ({
    label: connected ? 'Disconnect' : 'Remove',
    onSelect: () => askRemove(connected),
    disabled: busy(),
    danger: true,
    icon: 'disconnect',
  });

  // Only a server added by URL is named by the user.
  const renameItems = (): ConnectionMenuItem[] =>
    props.leftover.kind === 'server'
      ? [
          {
            label: 'Rename',
            onSelect: openRename,
            disabled: busy(),
            icon: 'rename',
          },
        ]
      : [];

  const reconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    icon: 'reconnect',
    onSelect: startConnect,
    disabled: busy(),
  });

  const actions = (): JSX.Element =>
    match(props.leftover.status)
      .with('not-connected', 'action-required', () => (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Connect"
              onClick={startConnect}
              disabled={busy()}
            />
          }
          items={[
            ...renameItems(),
            // A server never signed in to holds nothing to disconnect.
            disconnectItem(
              props.leftover.kind === 'app' ||
                props.leftover.status === 'action-required'
            ),
          ]}
        />
      ))
      .with('connected', () => (
        <ConnectionRowActions
          items={[
            {
              label: 'Disable',
              onSelect: () => setEnabled(false),
              disabled: busy(),
              icon: 'disable',
            },
            ...renameItems(),
            reconnectItem(),
            disconnectItem(),
          ]}
        />
      ))
      .with('off', () => (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Enable"
              variant="neutral"
              onClick={() => setEnabled(true)}
              disabled={busy()}
            />
          }
          items={[...renameItems(), reconnectItem(), disconnectItem()]}
        />
      ))
      .exhaustive();

  const status = (): IntegrationStatus =>
    match(props.leftover.status)
      .with('connected', () => 'connected' as const)
      .with('off', () => 'disconnected' as const)
      .with('action-required', 'not-connected', () => 'attention' as const)
      .exhaustive();

  const statusLabel = () =>
    match(props.leftover.status)
      .with('not-connected', () => 'Not connected')
      .with('action-required', () => 'Reconnect required')
      .otherwise(() => undefined);

  const row = (): JSX.Element =>
    match(props.leftover)
      .with({ kind: 'server' }, (item) => (
        <IntegrationListRow
          icon={<PlugIcon />}
          name={item.title}
          kind="mcp"
          description={item.subtitle}
          categories={leftoverCategories(item)}
          status={status()}
          statusLabel={statusLabel()}
          muted={status() === 'disconnected'}
        >
          {actions()}
        </IntegrationListRow>
      ))
      .with({ kind: 'app' }, (item) => (
        <IntegrationListRow
          icon={<ConnectedAppIcon appSlug={item.appSlug} class="size-5" />}
          name={item.title}
          kind="mcp"
          description={AGENT_APP_DESCRIPTION}
          categories={leftoverCategories(item)}
          status={status()}
          statusLabel={statusLabel()}
          muted={status() === 'disconnected'}
        >
          {actions()}
        </IntegrationListRow>
      ))
      .exhaustive();

  return (
    <>
      {row()}
      <DisconnectConfirmDialog
        request={disconnect()}
        onClose={() => setDisconnect(null)}
      />
      <Dialog
        open={renaming()}
        onOpenChange={(open) => !open && setRenaming(false)}
        position="center"
        visibleScrim
        class="w-100"
      >
        <Panel depth={2} class="rounded-xl">
          <Panel.Header class="px-6">
            <span class="text-ink text-sm font-semibold">Rename</span>
          </Panel.Header>
          <Panel.Body class="p-6 flex flex-col gap-5">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs text-ink-muted">Name</span>
              <input
                type="text"
                class="settings-input w-full"
                value={nameDraft()}
                onInput={(e) => setNameDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
            </label>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenaming(false)}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!nameDraft().trim() || update.isPending}
                onClick={saveRename}
              >
                {update.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}

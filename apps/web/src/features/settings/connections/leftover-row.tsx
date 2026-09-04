import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, createSignal, type JSX, on, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction } from '../integration-ui';
import {
  readMcpAuthAttempted,
  writeMcpAuthAttempted,
} from '../mcp-auth-attempt';
import { IntegrationRow, SettingsRow } from '../primitives';
import {
  type ConnectionMenuItem,
  ConnectionRowActions,
} from './connection-more';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import type { Leftover } from './model';
import { useNativeMcpActions } from './native-actions';

function leftoverDisabled(leftover: Leftover): boolean {
  return match(leftover)
    .with({ kind: 'native-mcp' }, (row) => row.authenticated && !row.enabled)
    .with({ kind: 'pipedream' }, (row) => !row.enabled)
    .exhaustive();
}

export function LeftoverRow(props: { leftover: Leftover }) {
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const [renaming, setRenaming] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const native = useNativeMcpActions();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();
  const [attempted, setAttempted] = createSignal(
    props.leftover.kind === 'native-mcp'
      ? readMcpAuthAttempted(props.leftover.url)
      : false
  );
  const [justStarted, setJustStarted] = createSignal(false);
  const { connect: connectPipedream, busy: pipedreamConnectBusy } =
    createPipedreamCatalogConnect({
      entry: () =>
        props.leftover.kind === 'pipedream'
          ? {
              app_slug: props.leftover.appSlug,
              display_name: props.leftover.title,
            }
          : { app_slug: '', display_name: props.leftover.title },
    });

  createEffect(
    on(
      () => {
        const leftover = props.leftover;
        return leftover.kind === 'native-mcp' && leftover.authenticated
          ? leftover.url
          : null;
      },
      (url) => {
        if (url) writeMcpAuthAttempted(url, false);
      }
    )
  );

  const busy = () =>
    native.update.isPending ||
    native.remove.isPending ||
    native.authorize.isPending ||
    updatePipedream.isPending ||
    deletePipedream.isPending ||
    pipedreamConnectBusy();

  const connectionFailed = () => {
    const leftover = props.leftover;
    return (
      leftover.kind === 'native-mcp' &&
      !leftover.authenticated &&
      !justStarted() &&
      attempted()
    );
  };

  const toggle = () => {
    match(props.leftover)
      .with({ kind: 'native-mcp' }, (leftover) => {
        native.update.mutate(
          { url: leftover.url, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update server') }
        );
      })
      .with({ kind: 'pipedream' }, (leftover) => {
        updatePipedream.mutate(
          { app_slug: leftover.appSlug, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update connector') }
        );
      })
      .exhaustive();
  };

  const remove = (connected: boolean) => {
    const leftover = props.leftover;
    const ok = connected ? 'Disconnected from Macro' : 'Removed';
    const fail = connected ? 'Failed to disconnect' : 'Failed to remove';
    match(leftover)
      .with({ kind: 'native-mcp' }, (row) => {
        native.remove.mutate(
          { url: row.url },
          {
            onSuccess: () => toast.success(ok),
            onError: () => toast.failure(fail),
          }
        );
      })
      .with({ kind: 'pipedream' }, (row) => {
        deletePipedream.mutate(
          { app_slug: row.appSlug },
          {
            onSuccess: () => toast.success(ok),
            onError: () => toast.failure(fail),
          }
        );
      })
      .exhaustive();
  };

  const startAuth = () => {
    const leftover = props.leftover;
    if (leftover.kind !== 'native-mcp') return;
    native.startAuth(leftover.url, leftover.title, {
      onStarted: () => {
        setAttempted(true);
        setJustStarted(true);
      },
      onFailed: () => {
        setAttempted(true);
        setJustStarted(false);
      },
    });
  };

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
    if (props.leftover.kind !== 'native-mcp') return;
    setNameDraft(props.leftover.title);
    setRenaming(true);
  };

  const saveRename = () => {
    const leftover = props.leftover;
    if (leftover.kind !== 'native-mcp') return;
    const name = nameDraft().trim();
    if (!name) return;
    native.update.mutate(
      { url: leftover.url, server_name: name },
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

  const renameItem = (): ConnectionMenuItem => ({
    label: 'Rename',
    onSelect: openRename,
    disabled: busy(),
    icon: 'rename',
  });

  const reconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    icon: 'reconnect',
    onSelect: () => {
      match(props.leftover)
        .with({ kind: 'native-mcp' }, () => {
          startAuth();
        })
        .with({ kind: 'pipedream' }, () => {
          void connectPipedream();
        })
        .exhaustive();
    },
    disabled: busy(),
  });

  const actions = (): JSX.Element =>
    match(props.leftover)
      .with({ kind: 'native-mcp', authenticated: false }, () => (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Connect"
              onClick={startAuth}
              disabled={busy()}
            />
          }
          items={[renameItem(), disconnectItem(false)]}
        />
      ))
      .with({ kind: 'native-mcp', enabled: true }, () => (
        <ConnectionRowActions
          items={[
            {
              label: 'Disable',
              onSelect: toggle,
              disabled: busy(),
              icon: 'disable',
            },
            renameItem(),
            reconnectItem(),
            disconnectItem(),
          ]}
        />
      ))
      .with({ kind: 'native-mcp' }, () => (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Enable"
              variant="neutral"
              onClick={toggle}
              disabled={busy()}
            />
          }
          items={[renameItem(), reconnectItem(), disconnectItem()]}
        />
      ))
      .with({ kind: 'pipedream', enabled: true }, () => (
        <ConnectionRowActions
          items={[
            {
              label: 'Disable',
              onSelect: toggle,
              disabled: busy(),
              icon: 'disable',
            },
            reconnectItem(),
            disconnectItem(),
          ]}
        />
      ))
      .with({ kind: 'pipedream' }, () => (
        <ConnectionRowActions
          primary={
            <ConnectAction
              label="Enable"
              variant="neutral"
              onClick={toggle}
              disabled={busy()}
            />
          }
          items={[reconnectItem(), disconnectItem()]}
        />
      ))
      .exhaustive();

  const row = (): JSX.Element => {
    const leftover = props.leftover;
    const muted = leftoverDisabled(leftover);
    return match(leftover)
      .with({ kind: 'native-mcp' }, (item) => (
        <SettingsRow
          label={item.title}
          description={
            <>
              <span class="block truncate">{item.subtitle}</span>
              <Show when={connectionFailed()}>
                <span class="block text-failure">Last attempt failed</span>
              </Show>
            </>
          }
          muted={muted}
        >
          {actions()}
        </SettingsRow>
      ))
      .with({ kind: 'pipedream' }, (item) => (
        <IntegrationRow
          icon={
            <PipedreamConnectorIcon appSlug={item.appSlug} class="size-8" />
          }
          title={item.title}
          description={item.subtitle}
          muted={muted}
        >
          {actions()}
        </IntegrationRow>
      ))
      .exhaustive();
  };

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
                variant="outline"
                size="sm"
                depth={3}
                onClick={() => setRenaming(false)}
              >
                Cancel
              </Button>
              <Button
                variant="accent"
                size="sm"
                depth={3}
                disabled={!nameDraft().trim() || native.update.isPending}
                onClick={saveRename}
              >
                {native.update.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}

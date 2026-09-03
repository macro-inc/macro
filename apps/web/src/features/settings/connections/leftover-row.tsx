import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import { openExternalUrl } from '@core/util/url';
import {
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Button, Dialog, Panel } from '@ui';
import { createEffect, createSignal, type JSX, Show } from 'solid-js';
import { ConnectAction, StatusDot } from '../integration-ui';
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

function leftoverOff(leftover: Leftover): boolean {
  switch (leftover.kind) {
    case 'native-mcp':
      return leftover.authenticated && !leftover.enabled;
    case 'pipedream':
      return !leftover.enabled;
    default: {
      const _exhaustive: never = leftover;
      return _exhaustive;
    }
  }
}

export function LeftoverRow(props: { leftover: Leftover }) {
  const [disconnect, setDisconnect] = createSignal<DisconnectConfirm | null>(
    null
  );
  const [renaming, setRenaming] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const updateNative = useUpdateMcpServerMutation();
  const deleteNative = useDeleteMcpServerMutation();
  const authorize = useStartMcpAuthMutation();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const deletePipedream = useDeletePipedreamConnectionMutation();
  const [attempted, setAttempted] = createSignal(
    props.leftover.kind === 'native-mcp'
      ? readMcpAuthAttempted(props.leftover.url)
      : false
  );
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

  createEffect(() => {
    const leftover = props.leftover;
    if (leftover.kind !== 'native-mcp') return;
    if (leftover.authenticated && attempted()) {
      writeMcpAuthAttempted(leftover.url, false);
      setAttempted(false);
    }
  });

  const busy = () =>
    updateNative.isPending ||
    deleteNative.isPending ||
    authorize.isPending ||
    updatePipedream.isPending ||
    deletePipedream.isPending ||
    pipedreamConnectBusy();

  const connectionFailed = () => {
    const leftover = props.leftover;
    return (
      leftover.kind === 'native-mcp' && !leftover.authenticated && attempted()
    );
  };

  const toggle = () => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        updateNative.mutate(
          { url: leftover.url, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update server') }
        );
        return;
      case 'pipedream':
        updatePipedream.mutate(
          { app_slug: leftover.appSlug, enabled: !leftover.enabled },
          { onError: () => toast.failure('Failed to update connector') }
        );
        return;
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  const remove = () => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        deleteNative.mutate(
          { url: leftover.url },
          {
            onSuccess: () => toast.success('Disconnected from Macro'),
            onError: () => toast.failure('Failed to disconnect'),
          }
        );
        return;
      case 'pipedream':
        deletePipedream.mutate(
          { app_slug: leftover.appSlug },
          {
            onSuccess: () => toast.success('Disconnected from Macro'),
            onError: () => toast.failure('Failed to disconnect'),
          }
        );
        return;
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  const startAuth = () => {
    const leftover = props.leftover;
    if (leftover.kind !== 'native-mcp') return;
    authorize.mutate(
      { server_url: leftover.url, server_name: leftover.title },
      {
        onSuccess: (result) => {
          openExternalUrl(result.authorization_url);
          writeMcpAuthAttempted(leftover.url, true);
          setAttempted(true);
        },
        onError: () => {
          writeMcpAuthAttempted(leftover.url, true);
          setAttempted(true);
          toast.failure('Failed to start authorization');
        },
      }
    );
  };

  const askDisconnect = () =>
    setDisconnect({
      title: 'Disconnect from Macro',
      body: `Disconnect ${props.leftover.title}?`,
      onConfirm: remove,
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
    updateNative.mutate(
      { url: leftover.url, server_name: name },
      {
        onSuccess: () => setRenaming(false),
        onError: () => toast.failure('Failed to update server'),
      }
    );
  };

  const disconnectItem = (): ConnectionMenuItem => ({
    label: 'Disconnect',
    onSelect: askDisconnect,
    disabled: busy(),
    danger: true,
  });

  const renameItem = (): ConnectionMenuItem => ({
    label: 'Rename',
    onSelect: openRename,
    disabled: busy(),
  });

  const reconnectItem = (): ConnectionMenuItem => ({
    label: 'Reconnect',
    onSelect: () => {
      const leftover = props.leftover;
      switch (leftover.kind) {
        case 'native-mcp':
          startAuth();
          return;
        case 'pipedream':
          void connectPipedream();
          return;
        default: {
          const _exhaustive: never = leftover;
          return _exhaustive;
        }
      }
    },
    disabled: busy(),
  });

  const actions = (): JSX.Element => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp': {
        if (!leftover.authenticated) {
          return (
            <ConnectionRowActions
              primary={
                <>
                  <Show when={connectionFailed()}>
                    <span class="text-xs text-failure whitespace-nowrap">
                      Last attempt failed
                    </span>
                  </Show>
                  <ConnectAction
                    label={connectionFailed() ? 'Try Again' : 'Connect'}
                    onClick={startAuth}
                    disabled={busy()}
                  />
                </>
              }
              items={[renameItem(), disconnectItem()]}
            />
          );
        }
        if (leftover.enabled) {
          return (
            <ConnectionRowActions
              items={[
                {
                  label: 'Turn off',
                  onSelect: toggle,
                  disabled: busy(),
                },
                renameItem(),
                reconnectItem(),
                disconnectItem(),
              ]}
            />
          );
        }
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Turn on"
                variant="neutral"
                onClick={toggle}
                disabled={busy()}
              />
            }
            items={[renameItem(), reconnectItem(), disconnectItem()]}
          />
        );
      }
      case 'pipedream':
        if (leftover.enabled) {
          return (
            <ConnectionRowActions
              items={[
                {
                  label: 'Turn off',
                  onSelect: toggle,
                  disabled: busy(),
                },
                reconnectItem(),
                disconnectItem(),
              ]}
            />
          );
        }
        return (
          <ConnectionRowActions
            primary={
              <ConnectAction
                label="Turn on"
                variant="neutral"
                onClick={toggle}
                disabled={busy()}
              />
            }
            items={[reconnectItem(), disconnectItem()]}
          />
        );
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
  };

  const offDot = () =>
    leftoverOff(props.leftover) ? (
      <StatusDot state="off" label="Off" />
    ) : undefined;

  const row = (): JSX.Element => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        return (
          <SettingsRow
            label={
              leftoverOff(leftover) ? (
                <span class="inline-flex items-center gap-2">
                  {leftover.title}
                  {offDot()}
                </span>
              ) : (
                leftover.title
              )
            }
            description={leftover.subtitle}
          >
            {actions()}
          </SettingsRow>
        );
      case 'pipedream':
        return (
          <IntegrationRow
            icon={
              <PipedreamConnectorIcon
                appSlug={leftover.appSlug}
                class="size-8"
              />
            }
            title={leftover.title}
            description={leftover.subtitle}
            status={offDot()}
          >
            {actions()}
          </IntegrationRow>
        );
      default: {
        const _exhaustive: never = leftover;
        return _exhaustive;
      }
    }
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
                disabled={!nameDraft().trim() || updateNative.isPending}
                onClick={saveRename}
              >
                {updateNative.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </Panel.Body>
        </Panel>
      </Dialog>
    </>
  );
}

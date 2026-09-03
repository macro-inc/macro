import { toast } from '@core/component/Toast/Toast';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import { openExternalUrl } from '@core/util/url';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import LinkBreakIcon from '@phosphor/link-break.svg';
import {
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  useDeletePipedreamConnectionMutation,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import { Button, Dialog, Dropdown, Panel, ToggleSwitch } from '@ui';
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { DisconnectAction } from '../integration-ui';
import {
  readMcpAuthAttempted,
  writeMcpAuthAttempted,
} from '../mcp-auth-attempt';
import { IntegrationRow, SettingsRow } from '../primitives';
import {
  type DisconnectConfirm,
  DisconnectConfirmDialog,
} from './disconnect-confirm';
import type { Leftover } from './model';

function leftoverCanToggle(leftover: Leftover): boolean {
  switch (leftover.kind) {
    case 'pipedream':
      return true;
    case 'native-mcp':
      return leftover.authenticated;
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
    deletePipedream.isPending;

  const connectionFailed = () => {
    const leftover = props.leftover;
    return (
      leftover.kind === 'native-mcp' && !leftover.authenticated && attempted()
    );
  };

  const connectLabel = () => {
    const leftover = props.leftover;
    if (leftover.kind !== 'native-mcp') return 'Connect';
    if (leftover.authenticated) return 'Reconnect';
    if (connectionFailed()) return 'Try Again';
    return 'Connect';
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

  const enableSwitch = () => (
    <Show when={leftoverCanToggle(props.leftover)}>
      <ToggleSwitch
        size="md"
        checked={props.leftover.enabled}
        disabled={busy()}
        onChange={toggle}
        label={`Enable ${props.leftover.title}`}
        labelClass="sr-only"
      />
    </Show>
  );

  const moreMenu = () => (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="More"
        class="relative inline-flex size-6 items-center justify-center rounded-md border-1 border-edge bg-transparent text-ink-muted outline-none hover:bg-hover hover:text-ink"
      >
        <DotsThreeIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-48">
        <Dropdown.Group>
          <Dropdown.Item disabled={busy()} onSelect={openRename}>
            Rename
          </Dropdown.Item>
          <Dropdown.Item disabled={busy()} onSelect={startAuth}>
            {connectLabel()}
          </Dropdown.Item>
          <Dropdown.Item
            class="text-failure"
            disabled={busy()}
            onSelect={askDisconnect}
          >
            <LinkBreakIcon class="size-4" />
            Disconnect
          </Dropdown.Item>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );

  const actions = (): JSX.Element => {
    switch (props.leftover.kind) {
      case 'native-mcp':
        return (
          <div class="flex items-center gap-4">
            <Show when={connectionFailed()}>
              <span class="text-xs text-failure whitespace-nowrap">
                Last attempt failed
              </span>
            </Show>
            {enableSwitch()}
            <Show when={leftoverCanToggle(props.leftover)}>
              <span class="h-6 w-px shrink-0 bg-ink/10" aria-hidden="true" />
            </Show>
            {moreMenu()}
          </div>
        );
      case 'pipedream':
        return (
          <>
            <DisconnectAction
              onClick={askDisconnect}
              disabled={busy()}
            />
            {enableSwitch()}
          </>
        );
      default: {
        const _exhaustive: never = props.leftover;
        return _exhaustive;
      }
    }
  };

  const row = (): JSX.Element => {
    const leftover = props.leftover;
    switch (leftover.kind) {
      case 'native-mcp':
        return (
          <SettingsRow
            label={leftover.title}
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

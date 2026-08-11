import {
  FEATURED_MCP_SERVERS,
  type FeaturedMcpServer,
  QUICK_CONNECT_ICON_MAP,
  type SvgIcon,
} from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import {
  useAddMcpServerMutation,
  useDeleteMcpServerMutation,
  useMcpServersQuery,
  useStartMcpAuthMutation,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import type {
  ServerResponse,
  StartAuthResponse,
} from '@service-cognition/generated/schemas';
import { Button, Dialog, Panel, ToggleSwitch } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { ConnectAction } from './integration-ui';
import { IntegrationRow, SettingsCard, SettingsSection } from './primitives';

/** Best-effort hostname for an MCP server URL — friendlier than the raw URL. */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** A single key-value header entry. */
function HeaderRow(props: {
  pair: { key: string; value: string };
  onChange: (pair: { key: string; value: string }) => void;
  onRemove: () => void;
}) {
  return (
    <div class="flex items-center gap-2">
      <input
        type="text"
        class="settings-input flex-1"
        placeholder="Header name"
        value={props.pair.key}
        onInput={(e) =>
          props.onChange({ key: e.currentTarget.value, value: props.pair.value })
        }
      />
      <span class="text-ink-muted text-xs">:</span>
      <input
        type="text"
        class="settings-input flex-1"
        placeholder="Value"
        value={props.pair.value}
        onInput={(e) =>
          props.onChange({ key: props.pair.key, value: e.currentTarget.value })
        }
      />
      <Button
        variant="base"
        size="sm"
        depth={3}
        tooltip="Remove header"
        onClick={props.onRemove}
      >
        <XIcon class="size-3.5" />
      </Button>
    </div>
  );
}

function AddServerForm(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = createSignal('');
  const [url, setUrl] = createSignal('');
  const [headers, setHeaders] = createSignal<{ key: string; value: string }[]>(
    []
  );
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();

  const reset = () => {
    setName('');
    setUrl('');
    setHeaders([]);
  };

  const addHeader = () => {
    setHeaders((prev) => [...prev, { key: '', value: '' }]);
  };

  const startAuth = (serverName: string, serverUrl: string) => {
    authMutation.mutate(
      { server_name: serverName, server_url: serverUrl },
      {
        onSuccess: (result: StartAuthResponse) => {
          openExternalUrl(result.authorization_url);
        },
        onError: () => {
          toast.failure('Server added but failed to start authorization');
        },
      }
    );
  };

  const headersObject = (): Record<string, string> | undefined => {
    const entries = headers()
      .filter((h) => h.key.trim() !== '')
      .map((h) => [h.key.trim(), h.value] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  };

  const handleSubmit = () => {
    const n = name().trim();
    const u = url().trim();
    if (!n || !u) return;

    addMutation.mutate(
      { server_name: n, url: u, headers: headersObject() },
      {
        onSuccess: () => {
          startAuth(n, u);
          reset();
          props.onOpenChange(false);
        },
        onError: () => {
          toast.failure('Failed to add server');
        },
      }
    );
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onOpenChange(false)}
      position="center"
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <span class="text-ink text-sm font-semibold">Add MCP Server</span>
        </Panel.Header>
        <Panel.Body class="p-6 flex flex-col gap-5">
          <div class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs text-ink-muted">Name</span>
              <input
                type="text"
                class="settings-input w-full"
                placeholder="My MCP Server"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') {
                    reset();
                    props.onOpenChange(false);
                  }
                }}
              />
            </label>
            <label class="flex flex-col gap-1.5">
              <span class="text-xs text-ink-muted">URL</span>
              <input
                type="url"
                class="settings-input w-full"
                placeholder="https://example.com/mcp"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                  if (e.key === 'Escape') {
                    reset();
                    props.onOpenChange(false);
                  }
                }}
              />
            </label>

            {/* Custom headers section */}
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-ink-muted">Custom Headers</span>
                <Button
                  variant="base"
                  size="sm"
                  depth={3}
                  onClick={addHeader}
                >
                  <PlusIcon class="size-3" />
                  Add
                </Button>
              </div>
              <For each={headers()}>
                {(pair, index) => (
                  <HeaderRow
                    pair={pair}
                    onChange={(updated) =>
                      setHeaders((prev) =>
                        prev.map((h, i) => (i === index() ? updated : h))
                      )
                    }
                    onRemove={() =>
                      setHeaders((prev) => prev.filter((_, i) => i !== index()))
                    }
                  />
                )}
              </For>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => {
                reset();
                props.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="active"
              size="sm"
              depth={3}
              disabled={
                !name().trim() || !url().trim() || addMutation.isPending
              }
              onClick={handleSubmit}
            >
              {addMutation.isPending ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

// We have no server-side signal for a failed auth, so we remember locally that a
// connect attempt was made. A disconnected server with a recorded attempt is
// treated as a failed connection; the flag is cleared once it authenticates.
const AUTH_ATTEMPT_PREFIX = 'mcp:auth-attempted:';

function readAuthAttempted(url: string): boolean {
  try {
    return localStorage.getItem(AUTH_ATTEMPT_PREFIX + url) === '1';
  } catch {
    return false;
  }
}

function writeAuthAttempted(url: string, attempted: boolean): void {
  try {
    if (attempted) localStorage.setItem(AUTH_ATTEMPT_PREFIX + url, '1');
    else localStorage.removeItem(AUTH_ATTEMPT_PREFIX + url);
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function HeadersConfigDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: ServerResponse;
  onSave: (headers: Record<string, string>) => void;
  saving: boolean;
}) {
  const initialHeaders = (): { key: string; value: string }[] => {
    const h = props.server.headers ?? {};
    return Object.entries(h).map(([key, value]) => ({ key, value }));
  };
  const [pairs, setPairs] = createSignal<
    { key: string; value: string }[]
  >(initialHeaders());

  // Reset when server changes
  createEffect(() => {
    if (props.open) {
      setPairs(initialHeaders());
    }
  });

  const addHeader = () => {
    setPairs((prev) => [...prev, { key: '', value: '' }]);
  };

  const handleSave = () => {
    const entries = pairs()
      .filter((h) => h.key.trim() !== '')
      .map((h) => [h.key.trim(), h.value] as const);
    props.onSave(Object.fromEntries(entries));
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onOpenChange(false)}
      position="center"
      class="w-120"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-6">
          <span class="text-ink text-sm font-semibold">
            Configure Headers — {props.server.server_name}
          </span>
        </Panel.Header>
        <Panel.Body class="p-6 flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-xs text-ink-muted">
                Custom headers sent with every request to this MCP server.
              </span>
              <Button variant="base" size="sm" depth={3} onClick={addHeader}>
                <PlusIcon class="size-3" />
                Add
              </Button>
            </div>
            <Show
              when={pairs().length > 0}
              fallback={
                <p class="py-4 text-center text-xs text-ink-muted">
                  No custom headers configured.
                </p>
              }
            >
              <For each={pairs()}>
                {(pair, index) => (
                  <HeaderRow
                    pair={pair}
                    onChange={(updated) =>
                      setPairs((prev) =>
                        prev.map((h, i) => (i === index() ? updated : h))
                      )
                    }
                    onRemove={() =>
                      setPairs((prev) => prev.filter((_, i) => i !== index()))
                    }
                  />
                )}
              </For>
            </Show>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              variant="active"
              size="sm"
              depth={3}
              disabled={props.saving}
              onClick={handleSave}
            >
              {props.saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function ServerRow(props: { server: ServerResponse }) {
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [attempted, setAttempted] = createSignal(
    readAuthAttempted(props.server.url)
  );
  const [showHeadersDialog, setShowHeadersDialog] = createSignal(false);

  // A recorded attempt on a still-disconnected server means the last connect
  // attempt didn't succeed. Clear the flag once the server authenticates.
  createEffect(() => {
    if (props.server.authenticated && attempted()) {
      writeAuthAttempted(props.server.url, false);
      setAttempted(false);
    }
  });

  const connectionFailed = () => !props.server.authenticated && attempted();

  const handleToggleEnabled = () => {
    updateMutation.mutate(
      { url: props.server.url, enabled: !props.server.enabled },
      {
        onError: () => {
          toast.failure('Failed to update server');
        },
      }
    );
  };

  const handleDelete = () => {
    deleteMutation.mutate(
      { url: props.server.url },
      {
        onSuccess: () => {
          toast.success('Server removed');
          setConfirmDelete(false);
        },
        onError: () => {
          toast.failure('Failed to remove server');
          setConfirmDelete(false);
        },
      }
    );
  };

  const handleAuth = () => {
    authMutation.mutate(
      {
        server_url: props.server.url,
        server_name: props.server.server_name,
      },
      {
        onSuccess: (result: StartAuthResponse) => {
          openExternalUrl(result.authorization_url);
          writeAuthAttempted(props.server.url, true);
          setAttempted(true);
        },
        onError: () => {
          writeAuthAttempted(props.server.url, true);
          setAttempted(true);
          toast.failure('Failed to start authorization');
        },
      }
    );
  };

  const handleSaveHeaders = (headers: Record<string, string>) => {
    updateMutation.mutate(
      { url: props.server.url, headers },
      {
        onSuccess: () => {
          setShowHeadersDialog(false);
          toast.success('Headers updated');
        },
        onError: () => {
          toast.failure('Failed to update headers');
        },
      }
    );
  };

  const Icon = (): SvgIcon =>
    QUICK_CONNECT_ICON_MAP.get(props.server.url) ?? (PlugIcon as SvgIcon);

  const hasHeaders = () =>
    props.server.headers &&
    Object.keys(props.server.headers).length > 0;

  return (
    <IntegrationRow
      icon={(() => {
        const C = Icon();
        return <C class="size-5" />;
      })()}
      title={
        <span class="flex items-center gap-1.5">
          <span class="min-w-0 truncate">{props.server.server_name}</span>
          <Show when={props.server.authenticated}>
            <CheckIcon class="size-3 shrink-0 text-success" />
          </Show>
          <Show when={connectionFailed()}>
            <XIcon class="size-3 shrink-0 text-failure" />
          </Show>
        </span>
      }
      description={hostFromUrl(props.server.url)}
    >
      <Show when={!props.server.authenticated}>
        <Show when={connectionFailed()}>
          <span class="text-xs text-failure whitespace-nowrap">
            Last attempt failed
          </span>
        </Show>
        <Button
          variant="active"
          size="sm"
          depth={3}
          disabled={authMutation.isPending}
          onClick={handleAuth}
        >
          {authMutation.isPending
            ? 'Connecting...'
            : connectionFailed()
              ? 'Try Again'
              : 'Connect'}
        </Button>
      </Show>

      <Show when={props.server.authenticated}>
        <ToggleSwitch
          size="md"
          checked={props.server.enabled}
          disabled={updateMutation.isPending}
          onChange={handleToggleEnabled}
          label={props.server.enabled ? 'Enabled' : 'Disabled'}
          labelClass="inline-block w-14 text-left text-xs text-ink-muted whitespace-nowrap"
        />
      </Show>

      <Button
        variant="base"
        size="sm"
        depth={3}
        tooltip="Configure headers"
        onClick={() => setShowHeadersDialog(true)}
      >
        <SlidersHorizontalIcon
          class={hasHeaders() ? 'size-4 text-accent' : 'size-4'}
        />
      </Button>

      <Show
        when={!confirmDelete()}
        fallback={
          <div class="flex items-center gap-1">
            <Button
              variant="danger"
              size="sm"
              depth={3}
              disabled={deleteMutation.isPending}
              onClick={handleDelete}
            >
              {deleteMutation.isPending ? 'Removing...' : 'Confirm'}
            </Button>
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <Button
          variant="base"
          size="sm"
          depth={3}
          tooltip="Remove"
          onClick={() => setConfirmDelete(true)}
        >
          <XIcon class="size-4" />
        </Button>
      </Show>

      <HeadersConfigDialog
        open={showHeadersDialog()}
        onOpenChange={setShowHeadersDialog}
        server={props.server}
        onSave={handleSaveHeaders}
        saving={updateMutation.isPending}
      />
    </IntegrationRow>
  );
}

/**
 * A featured integration the user hasn't connected yet, shown inline in the
 * integrations list (rather than only inside the "Add server" dialog) to make
 * connecting a one-click affair. Once connected, the server shows up as a
 * regular {@link ServerRow} instead.
 */
function FeaturedServerRow(props: { server: FeaturedMcpServer }) {
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();

  // Once the add lands, the cache update removes this suggestion row from the
  // list. mutate()-level callbacks are dropped for unmounted observers, so the
  // add → auth chain must run on mutateAsync promises instead.
  const handleConnect = async () => {
    try {
      await addMutation.mutateAsync({
        server_name: props.server.server_name,
        url: props.server.url,
      });
    } catch {
      toast.failure(`Failed to add ${props.server.server_name}`);
      return;
    }
    try {
      const result: StartAuthResponse = await authMutation.mutateAsync({
        server_name: props.server.server_name,
        server_url: props.server.url,
      });
      openExternalUrl(result.authorization_url);
    } catch {
      toast.failure('Server added but failed to start authorization');
    }
  };

  return (
    <IntegrationRow
      icon={<props.server.icon class="size-5" />}
      title={props.server.server_name}
      description={props.server.tagline}
    >
      <ConnectAction
        label="Connect"
        onClick={handleConnect}
        loading={addMutation.isPending || authMutation.isPending}
      />
    </IntegrationRow>
  );
}

/**
 * The "MCP integrations" section of the Connections page: MCP servers the
 * user has connected, followed by the preset suggestions they haven't, with
 * custom servers behind the "Add server" dialog.
 */
export function IntegrationsSection() {
  const serversQuery = useMcpServersQuery();
  const [showAddDialog, setShowAddDialog] = createSignal(false);

  const servers = () => serversQuery.data ?? [];
  const existingUrls = () => new Set(servers().map((s) => s.url));
  const suggestions = () =>
    FEATURED_MCP_SERVERS.filter((s) => !existingUrls().has(s.url));

  return (
    <SettingsSection
      title="MCP integrations"
      description="Connect MCP servers to give Macro's agent access to the tools your team already uses."
      actions={
        <Button
          variant="base"
          size="sm"
          depth={3}
          onClick={() => setShowAddDialog(true)}
        >
          <PlusIcon class="size-4" />
          Add server
        </Button>
      }
    >
      <Show when={serversQuery.isError}>
        <SettingsCard>
          <div class="px-6 py-8 text-center text-sm text-ink-muted">
            Failed to load integrations.
            <Button
              variant="base"
              size="sm"
              depth={3}
              onClick={() => serversQuery.refetch()}
              class="ml-2"
            >
              Retry
            </Button>
          </div>
        </SettingsCard>
      </Show>

      <Show when={!serversQuery.isError}>
        <SettingsCard>
          <For each={servers()}>
            {(server) => <ServerRow server={server} />}
          </For>
          <For each={suggestions()}>
            {(server) => <FeaturedServerRow server={server} />}
          </For>
        </SettingsCard>
      </Show>

      <AddServerForm open={showAddDialog()} onOpenChange={setShowAddDialog} />
    </SettingsSection>
  );
}

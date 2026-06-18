import { createEffect, createSignal, For, Show, Suspense } from 'solid-js';
import { TabsInset } from '@core/component/TabsInset';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import { Button, Layer, Panel, ToggleSwitch } from '@ui';
import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { toast } from '@core/component/Toast/Toast';
import type {
  ServerResponse,
  StartAuthResponse,
} from '@service-cognition/generated/schemas';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  useMcpServersQuery,
  useAddMcpServerMutation,
  useUpdateMcpServerMutation,
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
} from '@queries/mcp-servers';
import {
  agentSettingsSubTab,
  setAgentSettingsSubTab,
  type AgentSettingsSubTab,
} from '@core/constant/SettingsState';
import {
  QUICK_CONNECT_SERVERS,
  QUICK_CONNECT_ICON_MAP,
  type SvgIcon,
} from '@core/component/AI/constant/mcpServers';

type McpTab = AgentSettingsSubTab;

function AddServerForm(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUrls: Set<string>;
}) {
  const [name, setName] = createSignal('');
  const [url, setUrl] = createSignal('');
  const addMutation = useAddMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();

  const reset = () => {
    setName('');
    setUrl('');
  };

  const startAuth = (serverName: string, serverUrl: string) => {
    authMutation.mutate(
      { server_name: serverName, server_url: serverUrl },
      {
        onSuccess: (result: StartAuthResponse) => {
          window.open(result.authorization_url, '_blank');
        },
        onError: () => {
          toast.failure('Server added but failed to start authorization');
        },
      }
    );
  };

  const handleSubmit = () => {
    const n = name().trim();
    const u = url().trim();
    if (!n || !u) return;

    addMutation.mutate(
      { server_name: n, url: u },
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

  const handleQuickConnect = (server: { server_name: string; url: string }) => {
    addMutation.mutate(
      { server_name: server.server_name, url: server.url },
      {
        onSuccess: () => {
          startAuth(server.server_name, server.url);
          props.onOpenChange(false);
        },
        onError: () => {
          toast.failure(`Failed to add ${server.server_name}`);
        },
      }
    );
  };

  return (
    <ScopedPortal scope="local" show={props.open}>
      <Layer depth={3}>
        <div class="absolute inset-0 z-10 flex items-center justify-center bg-overlay">
          <div class="w-100 max-w-[calc(100%-2rem)]">
            <Panel active depth={3} class="shadow-md">
              <Panel.Header class="px-6">
                <span class="text-ink text-sm font-semibold">Add MCP Server</span>
              </Panel.Header>
              <Panel.Body class="p-6 flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <span class="text-xs text-ink-muted">Quick Connect</span>
                  <div class="grid grid-cols-2 gap-2">
                    <For each={QUICK_CONNECT_SERVERS}>
                      {(server) => {
                        const added = () => props.existingUrls.has(server.url);
                        return (
                          <button
                            class="flex items-center justify-between px-3 py-2 rounded-sm border border-edge-muted text-sm transition-colors"
                            classList={{
                              'bg-panel text-ink hover:bg-hover cursor-pointer': !added(),
                              'bg-panel text-ink-muted cursor-default': added(),
                            }}
                            disabled={added() || addMutation.isPending}
                            onClick={() => handleQuickConnect(server)}
                          >
                            <span class="flex items-center gap-2 text-accent">
                              <server.icon class="size-4" />
                              <span class="text-ink">{server.server_name}</span>
                            </span>
                            <Show when={added()}>
                              <span class="text-xs text-ink-muted">Added</span>
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </div>

                <div class="flex flex-col gap-4">
                  <span class="text-xs text-ink-muted">Custom Server</span>
                  <label class="flex flex-col gap-1.5">
                    <span class="text-xs text-ink-muted">Name</span>
                    <input
                      type="text"
                      class="h-8 px-2.5 rounded-lg border border-edge-muted bg-input text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent"
                      placeholder="My MCP Server"
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmit();
                        if (e.key === 'Escape') { reset(); props.onOpenChange(false); }
                      }}
                    />
                  </label>
                  <label class="flex flex-col gap-1.5">
                    <span class="text-xs text-ink-muted">URL</span>
                    <input
                      type="url"
                      class="h-8 px-2.5 rounded-lg border border-edge-muted bg-input text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent"
                      placeholder="https://example.com/mcp"
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSubmit();
                        if (e.key === 'Escape') { reset(); props.onOpenChange(false); }
                      }}
                    />
                  </label>
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
                    disabled={!name().trim() || !url().trim() || addMutation.isPending}
                    onClick={handleSubmit}
                  >
                    {addMutation.isPending ? 'Adding...' : 'Add'}
                  </Button>
                </div>
              </Panel.Body>
            </Panel>
          </div>
        </div>
      </Layer>
    </ScopedPortal>
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

function ServerRow(props: { server: ServerResponse }) {
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [attempted, setAttempted] = createSignal(
    readAuthAttempted(props.server.url)
  );

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
          window.open(result.authorization_url, '_blank');
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

  const Icon = (): SvgIcon =>
    QUICK_CONNECT_ICON_MAP.get(props.server.url) ?? (PlugIcon as SvgIcon);

  return (
    <div class="bg-panel flex items-center gap-4 @max-[480px]:gap-2 px-6 @max-[480px]:px-3 py-3">
      {(() => {
        const C = Icon();
        return <C class="size-5 shrink-0 text-accent" />;
      })()}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5">
          <span class="min-w-0 truncate text-sm font-medium text-ink">
            {props.server.server_name}
          </span>
          <Show when={props.server.authenticated}>
            <CheckIcon class="size-3 shrink-0 text-success" />
          </Show>
          <Show when={connectionFailed()}>
            <XIcon class="size-3 shrink-0 text-failure" />
          </Show>
        </div>
        <div class="text-xs text-ink-muted truncate">{props.server.url}</div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <Show when={!props.server.authenticated}>
          <Show when={connectionFailed()}>
            <span class="text-xs text-failure whitespace-nowrap">
              Last connection attempt failed
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
            checked={props.server.enabled}
            disabled={updateMutation.isPending}
            onChange={handleToggleEnabled}
            label={props.server.enabled ? 'Enabled' : 'Disabled'}
            labelClass="@max-[480px]:hidden inline-block w-14 text-left text-xs text-ink-muted whitespace-nowrap"
          />
        </Show>

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
            class="@max-[480px]:border-transparent"
            onClick={() => setConfirmDelete(true)}
          >
            <span class="@max-[480px]:hidden">Remove</span>
            <XIcon class="hidden size-4 @max-[480px]:block" />
          </Button>
        </Show>
      </div>
    </div>
  );
}

function Connectors() {
  const serversQuery = useMcpServersQuery();
  const [showAddDialog, setShowAddDialog] = createSignal(false);
  const hasServers = () => (serversQuery.data?.length ?? 0) > 0;

  return (
    <div class="@container">
    <div class="px-6 @max-[480px]:px-2 py-4 flex flex-col gap-4">
      <Show when={!hasServers()}>
        <div class="text-sm">
          Connect the Macro agent to external MCP servers
        </div>
      </Show>

      <Show when={serversQuery.isLoading}>
        <div class="text-sm text-ink-muted py-8 text-center">Loading...</div>
      </Show>

      <Show when={serversQuery.isError}>
        <div class="text-sm text-red-500 py-8 text-center">
          Failed to load servers.
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
      </Show>

      <Show when={serversQuery.data}>
        {(servers) => (
          <Show
            when={servers().length > 0}
            fallback={
              <div class="text-sm text-ink-muted py-8 text-center">
                No MCP servers configured yet.
              </div>
            }
          >
            <div class="flex flex-col rounded-sm overflow-hidden border border-edge-muted settings-row-dividers @max-[480px]:[&>*:not(:last-child)]:after:inset-x-3">
              <For each={servers()}>
                {(server) => <ServerRow server={server} />}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <div class="flex justify-center">
        <Button
          variant="active"
          size="sm"
          depth={3}
          onClick={() => setShowAddDialog(true)}
        >
          <PlusIcon class="size-4" />
          Add Server
        </Button>
      </div>

      <AddServerForm
        open={showAddDialog()}
        onOpenChange={setShowAddDialog}
        existingUrls={new Set(serversQuery.data?.map((s) => s.url) ?? [])}
      />
    </div>
    </div>
  );
}

function McpServer() {
  return (
    <div class="px-6">
      <div class="text-sm py-4"> Connect agents to Macro's MCP Server </div>
      <McpSetupCards class="max-w-none" />
    </div>
  );
}

export function Agent() {
  const tabList = [
    { value: 'connectors', label: 'Connectors' },
    { value: 'mcp_server', label: 'MCP Server' },
  ];

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2} class="relative portal-scope">
          <Panel.Header>
            <TabsInset
              list={tabList}
              value={agentSettingsSubTab()}
              defaultValue="connectors"
              onChange={(v) => setAgentSettingsSubTab(v as McpTab)}
            />
          </Panel.Header>
          <Panel.Body scroll>
            <Show when={agentSettingsSubTab() === 'connectors'}>
              <Suspense fallback={<div class="text-sm text-ink-muted py-8 text-center">Loading...</div>}>
                <Connectors />
              </Suspense>
            </Show>
            <Show when={agentSettingsSubTab() === 'mcp_server'}>
              <McpServer />
            </Show>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}

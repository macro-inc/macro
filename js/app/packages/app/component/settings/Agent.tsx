import { createSignal, For, Show, Suspense } from 'solid-js';
import { Tabs } from '@core/component/Tabs';
import { Button, Layer, Panel } from '@ui';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { toast } from '@core/component/Toast/Toast';
import type { ServerResponse } from '@service-cognition/generated/schemas';
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
        onSuccess: (result) => {
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
                      class="h-8 px-2.5 rounded-sm border border-edge-muted bg-input text-sm text-ink outline-none placeholder:text-ink-muted focus:border-edge"
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
                      class="h-8 px-2.5 rounded-sm border border-edge-muted bg-input text-sm text-ink outline-none placeholder:text-ink-muted focus:border-edge"
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

function ServerRow(props: { server: ServerResponse }) {
  const updateMutation = useUpdateMcpServerMutation();
  const deleteMutation = useDeleteMcpServerMutation();
  const authMutation = useStartMcpAuthMutation();
  const [confirmDelete, setConfirmDelete] = createSignal(false);

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
        onSuccess: (result) => {
          window.open(result.authorization_url, '_blank');
        },
        onError: () => {
          toast.failure('Failed to start authorization');
        },
      }
    );
  };

  const Icon = () => QUICK_CONNECT_ICON_MAP.get(props.server.url);

  return (
    <div class="bg-panel flex items-center gap-4 px-6 py-3">
      <Show when={Icon()}>
        {(IconComp) => {
          const C = IconComp() as SvgIcon;
          return <C class="size-5 shrink-0 text-accent" />;
        }}
      </Show>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium text-ink truncate">
          {props.server.server_name}
        </div>
        <div class="text-xs text-muted truncate">{props.server.url}</div>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <Show when={!props.server.authenticated}>
          <Button
            variant="active"
            size="sm"
            depth={3}
            disabled={authMutation.isPending}
            onClick={handleAuth}
          >
            {authMutation.isPending ? 'Connecting...' : 'Connect'}
          </Button>
        </Show>

        <Show when={props.server.authenticated}>
          <span class="text-xs text-green-500">Connected</span>
          <Button
            variant="base"
            size="sm"
            depth={3}
            disabled={updateMutation.isPending}
            onClick={handleToggleEnabled}
          >
            {props.server.enabled ? 'Disable' : 'Enable'}
          </Button>
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
            onClick={() => setConfirmDelete(true)}
          >
            Remove
          </Button>
        </Show>
      </div>
    </div>
  );
}

function Connectors() {
  const serversQuery = useMcpServersQuery();
  const [showAddDialog, setShowAddDialog] = createSignal(false);

  return (
    <div class="px-6 py-4 flex flex-col gap-4">
      <div class="flex items-center justify-between">
          <div class="text-sm">
            Connect the Macro agent to external MCP servers
          </div>
        <Button
          variant="active"
          size="sm"
          onClick={() => { setShowAddDialog(true) }}
        >
          Add Server
        </Button>
      </div>

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
            <div class="grid gap-px bg-edge-muted rounded-sm overflow-hidden border border-edge-muted">
              <For each={servers()}>
                {(server) => <ServerRow server={server} />}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <AddServerForm
        open={showAddDialog()}
        onOpenChange={setShowAddDialog}
        existingUrls={new Set(serversQuery.data?.map((s) => s.url) ?? [])}
      />
    </div>
  );
}

function McpServer() {
  return (
    <div class="px-6">
      <div class="text-sm py-4"> Connect agents to Macro </div>
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
            <Tabs
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

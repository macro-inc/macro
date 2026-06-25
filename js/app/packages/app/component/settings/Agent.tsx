import { createEffect, createSignal, For, Show, Suspense } from 'solid-js';
import PlusIcon from '@phosphor-icons/core/regular/plus.svg?component-solid';
import PlugIcon from '@phosphor-icons/core/regular/plug.svg?component-solid';
import { Button, Dialog, Panel, ToggleSwitch } from '@ui';
import CheckIcon from '@phosphor-icons/core/regular/check.svg?component-solid';
import XIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { McpSetupCards } from '@core/component/AI/component/McpSetupCards';
import { toast } from '@core/component/Toast/Toast';
import type {
  ServerResponse,
  StartAuthResponse,
} from '@service-cognition/generated/schemas';
import {
  useMcpServersQuery,
  useAddMcpServerMutation,
  useUpdateMcpServerMutation,
  useDeleteMcpServerMutation,
  useStartMcpAuthMutation,
} from '@queries/mcp-servers';
import {
  QUICK_CONNECT_SERVERS,
  QUICK_CONNECT_ICON_MAP,
  type SvgIcon,
} from '@core/component/AI/constant/mcpServers';
import {
  IntegrationRow,
  SettingsCard,
  SettingsPage,
  SettingsSection,
} from './primitives';

/** Best-effort hostname for an MCP server URL — friendlier than the raw URL. */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

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
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onOpenChange(false)}
      position="center"
      class="w-100"
    >
      <Panel depth={2} class="rounded-xl">
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
                      class="flex items-center justify-between px-3 py-2 rounded-lg border border-edge-muted text-sm transition-colors"
                      classList={{
                        'text-ink hover:bg-ink/4 cursor-pointer': !added(),
                        'text-ink-muted cursor-default': added(),
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
    <IntegrationRow
      icon={(() => {
        const C = Icon();
        return <C class="size-5 text-accent" />;
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
    </IntegrationRow>
  );
}

function Connectors() {
  const serversQuery = useMcpServersQuery();
  const [showAddDialog, setShowAddDialog] = createSignal(false);

  return (
    <SettingsSection
      title="Connectors"
      description="Connect Macro's agent to external MCP servers."
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
        </SettingsCard>
      </Show>

      <Show when={serversQuery.data}>
        {(servers) => (
          <Show
            when={servers().length > 0}
            fallback={
              <SettingsCard>
                <div class="px-6 py-8 text-center text-sm text-ink-muted">
                  No MCP servers connected yet.
                </div>
              </SettingsCard>
            }
          >
            <SettingsCard>
              <For each={servers()}>
                {(server) => <ServerRow server={server} />}
              </For>
            </SettingsCard>
          </Show>
        )}
      </Show>

      <AddServerForm
        open={showAddDialog()}
        onOpenChange={setShowAddDialog}
        existingUrls={new Set(serversQuery.data?.map((s) => s.url) ?? [])}
      />
    </SettingsSection>
  );
}

export function Agent() {
  return (
    <SettingsPage
      title="MCPs"
      description="Connect Macro's agent to external tools, or connect other agents to Macro."
    >
      <Suspense
        fallback={
          <div class="text-sm text-ink-muted py-8 text-center">Loading...</div>
        }
      >
        <Connectors />
      </Suspense>

      <SettingsSection
        title="Macro MCP server"
        description="Connect other agents and tools to your Macro workspace."
      >
        <McpSetupCards class="max-w-none" />
      </SettingsSection>
    </SettingsPage>
  );
}

import {
  SettingsCard,
  SettingsSurface,
} from '@app/features/settings/primitives';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, Dialog, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { ExternalAgentCredentialsPanel } from '../components/external-agent-credentials';
import { ExternalAgentRow } from '../components/external-agent-row';
import {
  agentApiUrl,
  type ExternalAgent,
  type ExternalAgentCredentials,
} from '../core/external-agent';
import {
  externalAgentErrorMessage,
  toExternalAgent,
  useDeleteExternalAgent,
  useExternalAgents,
  useIssueExternalAgentToken,
  useRegisterExternalAgent,
  useVerifyExternalAgentEndpoint,
} from '../queries/external-agents';
import {
  ConnectExternalAgentForm,
  type ConnectExternalAgentInput,
} from './connect-external-agent-form';

/**
 * Agents whose runtime lives outside Macro: connect one, hand its runtime
 * its credentials, and DM it. Rendered inside a settings surface.
 */
export function ExternalAgentsSection(props: {
  currentTeamId?: string;
  onMessage?: (agentId: string) => void;
  messagePending?: boolean;
}) {
  const list = useExternalAgents();
  const register = useRegisterExternalAgent();
  const verify = useVerifyExternalAgentEndpoint();
  const issueToken = useIssueExternalAgentToken();
  const remove = useDeleteExternalAgent();
  const [connecting, setConnecting] = createSignal(false);
  const [connectError, setConnectError] = createSignal<string>();
  const [credentials, setCredentials] =
    createSignal<ExternalAgentCredentials>();
  const [deleting, setDeleting] = createSignal<ExternalAgent>();
  const apiUrl = agentApiUrl(SERVER_HOSTS['document-storage-service']);
  const busy = () =>
    verify.isPending || issueToken.isPending || remove.isPending;

  const connect = async (input: ConnectExternalAgentInput) => {
    setConnectError(undefined);
    const result = await register.mutateAsync({
      input: {
        name: input.name,
        handle: input.handle,
        endpointUrl: input.endpointUrl,
        teamId: input.shareWithTeam ? props.currentTeamId : undefined,
      },
    });
    const registered = result.data?.registerExternalAgent;
    if (!registered) {
      setConnectError(
        externalAgentErrorMessage(result.error) ?? 'Could not connect agent'
      );
      return;
    }
    setConnecting(false);
    setCredentials({
      agent: toExternalAgent(registered.agent),
      botToken: registered.botToken,
      signingSecret: registered.signingSecret ?? undefined,
    });
    fireAndForget(list.refresh(), 'external-agents');
  };

  const verifyEndpoint = async (agent: ExternalAgent) => {
    const result = await verify.mutateAsync({ agentId: agent.id });
    const checked = result.data?.verifyExternalAgentEndpoint;
    if (!checked) {
      toast.failure(
        externalAgentErrorMessage(result.error) ?? 'Could not verify endpoint'
      );
      return;
    }
    if (checked.agent.endpoint?.verified) {
      toast.success('Endpoint verified');
    } else {
      toast.failure(
        checked.responseStatus
          ? `The endpoint answered ${checked.responseStatus}`
          : (checked.message ?? 'The endpoint did not answer')
      );
    }
  };

  const newToken = async (agent: ExternalAgent) => {
    const result = await issueToken.mutateAsync({ agentId: agent.id });
    const botToken = result.data?.issueExternalAgentToken;
    if (!botToken) {
      toast.failure(
        externalAgentErrorMessage(result.error) ?? 'Could not create a token'
      );
      return;
    }
    setCredentials({ agent, botToken });
  };

  const deleteAgent = async () => {
    const agent = deleting();
    if (!agent) return;
    const result = await remove.mutateAsync({ agentId: agent.id });
    if (!result.data?.deleteExternalAgent) {
      toast.failure(
        externalAgentErrorMessage(result.error) ?? 'Could not delete agent'
      );
      return;
    }
    setDeleting(undefined);
    toast.success('Agent deleted');
    fireAndForget(list.refresh(), 'external-agents');
  };

  return (
    <section aria-label="External agents">
      <SettingsSurface class="flex flex-col gap-2 p-5 touch:p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <h2 class="text-base font-medium text-ink">External agents</h2>
            <p class="text-sm leading-relaxed text-ink/60">
              Assistants that run outside Macro. DM or mention them here; they
              answer through the agent API with their own token.
            </p>
          </div>
          <Show when={!connecting() && !credentials()}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConnecting(true)}
            >
              <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              Connect agent
            </Button>
          </Show>
        </div>
        <SettingsCard>
          <Show when={connecting()}>
            <ConnectExternalAgentForm
              canShareWithTeam={props.currentTeamId !== undefined}
              pending={register.isPending}
              error={connectError()}
              onCancel={() => {
                setConnecting(false);
                setConnectError(undefined);
              }}
              onSubmit={(input) =>
                fireAndForget(connect(input), 'external-agents')
              }
            />
          </Show>
          <Show when={credentials()}>
            {(handedOver) => (
              <ExternalAgentCredentialsPanel
                credentials={handedOver()}
                apiUrl={apiUrl}
                onDone={() => setCredentials(undefined)}
              />
            )}
          </Show>
          <Show when={!connecting() && !credentials()}>
            <For each={list.agents()}>
              {(agent) => (
                <ExternalAgentRow
                  agent={agent}
                  busy={busy() || props.messagePending}
                  onMessage={
                    props.onMessage
                      ? () => props.onMessage?.(agent.id)
                      : undefined
                  }
                  onVerify={
                    agent.endpoint
                      ? () =>
                          fireAndForget(
                            verifyEndpoint(agent),
                            'external-agents'
                          )
                      : undefined
                  }
                  onNewToken={() =>
                    fireAndForget(newToken(agent), 'external-agents')
                  }
                  onDelete={() => setDeleting(agent)}
                />
              )}
            </For>
            <Show when={list.pending()}>
              <p class="px-6 py-4 text-sm text-ink-muted">Loading agents…</p>
            </Show>
            <Show when={!list.pending() && list.agents()?.length === 0}>
              <p class="px-6 py-4 text-sm text-ink-muted">
                No external agents yet.
              </p>
            </Show>
            <Show when={list.error() && !list.agents()}>
              <p class="px-6 py-4 text-xs text-negative">
                Could not load external agents. Try refreshing this page.
              </p>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSurface>
      <Show when={deleting()}>
        {(agent) => (
          <Dialog
            open
            onOpenChange={(open) =>
              !open && !remove.isPending && setDeleting(undefined)
            }
            position="center"
            visibleScrim
            class="w-[min(480px,calc(100vw-16px))]"
          >
            <Panel depth={2} class="rounded-xl text-ink">
              <Panel.Header class="px-5 py-3">
                <Dialog.Title class="text-sm font-semibold">
                  Delete {agent().name}?
                </Dialog.Title>
              </Panel.Header>
              <Panel.Body class="p-5">
                <Dialog.Description class="text-sm leading-5 text-ink-muted">
                  Its tokens stop working, Macro stops delivering its events,
                  and its inbox is deleted. Conversations with it stay.
                </Dialog.Description>
              </Panel.Body>
              <Panel.Footer class="justify-end gap-2 px-5 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => setDeleting(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() =>
                    fireAndForget(deleteAgent(), 'external-agents')
                  }
                >
                  {remove.isPending ? 'Deleting…' : 'Delete agent'}
                </Button>
              </Panel.Footer>
            </Panel>
          </Dialog>
        )}
      </Show>
    </section>
  );
}

import { CredentialField } from '@app/features/channel/Bots/CredentialField';
import CheckCircleIcon from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?component-solid';
import { Button } from '@ui';
import { Show } from 'solid-js';
import {
  type ExternalAgentCredentials,
  replyExample,
} from '../core/external-agent';

/** Credentials minted for an external agent, shown once. */
export function ExternalAgentCredentialsPanel(props: {
  credentials: ExternalAgentCredentials;
  apiUrl: string;
  onDone: () => void;
}) {
  const endpoint = () => props.credentials.agent.endpoint;
  return (
    <div class="flex flex-col gap-5 p-5 touch:p-4">
      <header class="flex items-center gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success-bg text-success">
          <CheckCircleIcon class="size-5" />
        </div>
        <div class="min-w-0">
          <h3 class="text-sm font-semibold text-ink">
            {props.credentials.agent.name} is connected
          </h3>
          <p class="mt-0.5 text-xs text-ink-muted">
            Copy these now: they are shown only once.
          </p>
        </div>
      </header>

      <Show when={props.credentials.botToken}>
        {(token) => (
          <CredentialField
            label="Bot token"
            value={token()}
            help="Send as x-macro-bot-token"
          />
        )}
      </Show>
      <Show when={props.credentials.signingSecret}>
        {(secret) => (
          <CredentialField
            label="Signing secret"
            value={secret()}
            help="Verifies X-Macro-Signature on each push"
          />
        )}
      </Show>
      <CredentialField
        label="Agent API"
        value={props.apiUrl}
        help="GraphQL: externalAgent.events, replyToExternalAgentEvent"
      />

      <p class="text-xs leading-relaxed text-ink-muted">
        <Show
          when={endpoint()}
          fallback="Its runtime polls externalAgent.events for the messages that DM or mention it, then replies to each event."
        >
          {(endpoint) =>
            endpoint().verified
              ? 'Macro pushes each message that DMs or mentions it to its endpoint as external_agent.message; its runtime replies to the event.'
              : 'Its endpoint did not answer the signed validation request yet. Start it, then press Verify; until then its runtime can poll externalAgent.events.'
          }
        </Show>
      </p>
      <Show when={props.credentials.botToken}>
        {(token) => (
          <pre class="overflow-x-auto rounded-lg border border-edge-muted bg-ink/[0.025] p-3 font-mono text-xxs leading-relaxed text-ink-muted">
            {replyExample(props.apiUrl, token())}
          </pre>
        )}
      </Show>

      <div class="flex justify-end">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={props.onDone}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

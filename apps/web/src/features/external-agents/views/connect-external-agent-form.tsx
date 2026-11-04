import { Button, Checkbox } from '@ui';
import { createSignal, Show } from 'solid-js';
import { handleFor } from '../core/external-agent';

export type ConnectExternalAgentInput = {
  name: string;
  handle: string;
  endpointUrl?: string;
  shareWithTeam: boolean;
};

/** Name, handle, and optional endpoint of an agent to connect. */
export function ConnectExternalAgentForm(props: {
  canShareWithTeam: boolean;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (input: ConnectExternalAgentInput) => void;
}) {
  const [name, setName] = createSignal('');
  const [handle, setHandle] = createSignal('');
  const [handleEdited, setHandleEdited] = createSignal(false);
  const [endpointUrl, setEndpointUrl] = createSignal('');
  const [shareWithTeam, setShareWithTeam] = createSignal(false);
  const ready = () => name().trim().length > 0 && handle().length > 0;

  return (
    <form
      class="flex flex-col gap-4 p-5 touch:p-4"
      aria-label="Connect an external agent"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready() || props.pending) return;
        props.onSubmit({
          name: name().trim(),
          handle: handle(),
          endpointUrl: endpointUrl().trim() || undefined,
          shareWithTeam: shareWithTeam(),
        });
      }}
    >
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">Name</span>
          <input
            autofocus
            class="settings-input w-full"
            placeholder="My assistant"
            value={name()}
            onInput={(event) => {
              setName(event.currentTarget.value);
              if (!handleEdited())
                setHandle(handleFor(event.currentTarget.value));
            }}
          />
        </label>
        <label for="external-agent-handle" class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-ink">@tag</span>
          <div class="flex items-center rounded-lg border border-edge-muted px-2 focus-within:border-accent">
            <span class="text-sm text-ink-extra-muted">@</span>
            <input
              id="external-agent-handle"
              aria-label="@tag"
              class="min-w-0 flex-1 bg-transparent px-1.5 py-2 text-sm text-ink outline-none"
              placeholder="my-assistant"
              value={handle()}
              onInput={(event) => {
                setHandleEdited(true);
                setHandle(handleFor(event.currentTarget.value));
              }}
            />
          </div>
        </label>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-xs font-medium text-ink">
          Webhook endpoint{' '}
          <span class="font-normal text-ink-extra-muted">· optional</span>
        </span>
        <input
          type="url"
          class="settings-input w-full"
          placeholder="https://my-agent.example.com/macro"
          value={endpointUrl()}
          onInput={(event) => setEndpointUrl(event.currentTarget.value)}
        />
        <span class="text-xs text-ink-muted">
          Macro pushes every message that DMs or mentions the agent here,
          signed. Leave it empty and the agent can poll for them instead.
        </span>
      </label>
      <Show when={props.canShareWithTeam}>
        <Checkbox
          class="flex items-center gap-2 text-sm text-ink"
          checked={shareWithTeam()}
          onChange={setShareWithTeam}
        >
          <Checkbox.Control />
          <Checkbox.Label>Share with my team</Checkbox.Label>
        </Checkbox>
      </Show>
      <Show when={props.error}>
        {(error) => <p class="text-xs text-negative">{error()}</p>}
      </Show>
      <div class="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={!ready() || props.pending}
        >
          {props.pending ? 'Connecting…' : 'Connect agent'}
        </Button>
      </div>
    </form>
  );
}

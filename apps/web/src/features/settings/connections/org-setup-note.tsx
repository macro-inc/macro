import type { ConnectorOrgSetupResponse } from '@service-cognition/client';
import { createSignal, For, Show } from 'solid-js';

/** What the user's admin must do at the vendor, opened from a catalog row. */
export function OrgSetupNote(props: { setup: ConnectorOrgSetupResponse }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="flex flex-col gap-1 text-xs text-ink-muted">
      <button
        type="button"
        class="w-fit underline touch:min-h-11"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        {props.setup.required
          ? 'Needs your admin first'
          : 'Your admin may need to approve this'}
      </button>
      <Show when={open()}>
        <p>{props.setup.summary}</p>
        <ol class="list-decimal pl-4">
          <For each={props.setup.steps}>{(step) => <li>{step}</li>}</For>
        </ol>
        <Show when={props.setup.allowlist_url}>
          {(url) => <code class="break-all">{url()}</code>}
        </Show>
        <a
          class="w-fit underline"
          href={props.setup.settings_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Where to do this
        </a>
      </Show>
    </div>
  );
}

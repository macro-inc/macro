import type { CatalogOrgSetup } from '@queries/connectors';
import { createSignal, createUniqueId, For, Show } from 'solid-js';

/** What the user's admin must do at the vendor, opened from a catalog row. */
export function OrgSetupNote(props: { setup: CatalogOrgSetup }) {
  const [open, setOpen] = createSignal(false);
  const panel = createUniqueId();
  return (
    <div class="flex flex-col gap-1 text-xs text-ink-muted">
      <button
        type="button"
        class="w-fit underline touch:min-h-11"
        aria-expanded={open()}
        aria-controls={panel}
        onClick={() => setOpen(!open())}
      >
        {props.setup.required
          ? 'Needs your admin first'
          : 'Your admin may need to approve this'}
      </button>
      <Show when={open()}>
        <div id={panel} class="flex flex-col gap-1">
          <p>{props.setup.summary}</p>
          <ol class="list-decimal pl-4">
            <For each={props.setup.steps}>{(step) => <li>{step}</li>}</For>
          </ol>
          <Show when={props.setup.allowlistUrl}>
            {(url) => <code class="break-all">{url()}</code>}
          </Show>
          <a
            class="w-fit underline"
            href={props.setup.settingsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Where to do this
          </a>
        </div>
      </Show>
    </div>
  );
}

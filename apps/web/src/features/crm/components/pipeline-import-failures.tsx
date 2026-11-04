import { For, Show } from 'solid-js';

/** Rejected entries remain identifiable without discarding successful imports. */
export function PipelineImportFailures(props: {
  addLabel: 'Add deal' | 'Add contact';
  failures?: { entry: number; key: string; reason: string }[];
}) {
  return (
    <Show when={props.failures?.length}>
      <div class="text-sm" role="alert">
        <p>
          {props.failures?.length.toLocaleString()}{' '}
          {props.failures?.length === 1 ? 'entry' : 'entries'} could not be
          added. Use {props.addLabel} to add these entries with the listed
          fields filled in.
        </p>
        <ul class="mt-2 max-h-48 overflow-y-auto space-y-1 text-failure">
          <For each={props.failures}>
            {(failure) => (
              <li>
                Entry {failure.entry} ({failure.key}): {failure.reason}
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

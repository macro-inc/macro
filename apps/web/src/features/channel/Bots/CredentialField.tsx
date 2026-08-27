import { CopyButton } from '@ui';
import { Show } from 'solid-js';

export function CredentialField(props: {
  label: string;
  value: string;
  help?: string;
}) {
  const copyLabel = () => props.label.toLowerCase();

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-xs font-medium text-ink">{props.label}</span>
        <Show when={props.help}>
          <span class="text-xs text-ink-muted">{props.help}</span>
        </Show>
      </div>
      <div class="flex min-w-0 items-center gap-2 rounded-lg border border-edge-muted bg-ink/[0.025] px-3 py-2">
        <input
          readOnly
          value={props.value}
          class="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none"
          onClick={(event) => event.currentTarget.select()}
        />
        <CopyButton
          type="button"
          label={`Copy ${copyLabel()}`}
          successLabel={`Copied ${copyLabel()}`}
          failureLabel={`Failed to copy ${copyLabel()}`}
          text={props.value}
        />
      </div>
    </div>
  );
}

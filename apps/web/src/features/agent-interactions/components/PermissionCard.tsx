import ShieldCheck from '@phosphor/shield-check.svg';
import { Show } from 'solid-js';
import {
  PermissionOptions,
  type PermissionOptionsProps,
} from './PermissionOptions';

/** A pending decision, with the action separated from its approval controls. */
export function PermissionCard(
  props: PermissionOptionsProps & {
    action?: string;
    detail?: string;
    canAnswer: boolean;
  }
) {
  return (
    <section
      aria-label="Permission request"
      class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-4 pt-4">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
          <ShieldCheck class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">Approval needed</div>
          <p class="mt-0.5 text-xs leading-5 text-ink-muted">
            {props.canAnswer
              ? 'Review this action before the agent continues.'
              : 'Waiting for a session editor to approve this action.'}
          </p>
        </div>
      </div>
      <Show when={props.action || props.detail}>
        <div class="mx-4 mt-3 rounded-lg bg-surface px-3 py-2.5">
          <Show when={props.action}>
            <div class="text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">
              {props.action}
            </div>
          </Show>
          <Show when={props.detail}>
            <pre class="mt-1 max-h-32 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {props.detail}
            </pre>
          </Show>
        </div>
      </Show>
      <div class="p-3">
        <Show when={props.canAnswer}>
          <PermissionOptions
            options={props.options}
            disabled={props.disabled}
            onSelect={props.onSelect}
          />
        </Show>
      </div>
    </section>
  );
}

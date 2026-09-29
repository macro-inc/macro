import ShieldCheck from '@phosphor/shield-check.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export type ToolApprovalCardProps = {
  /** What a person calls the server, e.g. `Macro` or `Linear`. */
  server: string;
  tool: string;
  /** The arguments, formatted for reading. */
  detail?: string;
  /** Who prompted the turn; absent for a bot on nobody's behalf. */
  requester?: string;
  /** The session's owner, whose access the call spends. */
  owner: string;
  /** The viewer is the owner. */
  canApprove: boolean;
  /** The viewer may give up waiting on the owner. */
  canCancel: boolean;
  /** An answer is on the wire. */
  disabled?: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onCancel: () => void;
};

/**
 * A tool call held for the session owner: approve or decline for them,
 * "waiting for the owner" with a way out for everyone else.
 */
export function ToolApprovalCard(props: ToolApprovalCardProps) {
  const asker = () => props.requester ?? 'A bot';
  return (
    <section
      aria-label="Tool approval request"
      class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-4 pt-4">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent">
          <ShieldCheck class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {props.canApprove
              ? 'Approval needed'
              : `Waiting for ${props.owner} to approve`}
          </div>
          <p class="mt-0.5 text-xs leading-5 text-ink-muted">
            {props.canApprove
              ? `${asker()} asked the agent to use a tool with your access.`
              : `${asker()} asked the agent to use a tool with ${props.owner}'s access, so it waits for them.`}
          </p>
        </div>
      </div>
      <div class="mx-4 mt-3 rounded-lg bg-surface px-3 py-2.5">
        <div class="text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">
          {props.server} · {props.tool}
        </div>
        <Show when={props.detail}>
          <pre class="mt-1 max-h-32 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {props.detail}
          </pre>
        </Show>
      </div>
      <div class="flex min-w-0 flex-wrap items-center justify-end gap-2 p-3">
        <Show
          when={props.canApprove}
          fallback={
            <Show when={props.canCancel}>
              <Button
                type="button"
                size="md"
                variant="outline"
                disabled={props.disabled}
                onClick={() => props.onCancel()}
              >
                Cancel
              </Button>
            </Show>
          }
        >
          <Button
            type="button"
            size="md"
            variant="ghost"
            class="mr-auto"
            disabled={props.disabled}
            onClick={() => props.onDeny()}
          >
            Decline
          </Button>
          <Button
            type="button"
            size="md"
            variant="strong"
            disabled={props.disabled}
            onClick={() => props.onApprove()}
          >
            Approve
          </Button>
        </Show>
      </div>
    </section>
  );
}

import ShieldCheck from '@phosphor/shield-check.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export type ToolApprovalCardProps = {
  /** What the agent wants to do, e.g. `read your email`. */
  action: string;
  /**
   * What approving for good would let the requester do without asking, e.g.
   * `use your Linear account`. Absent when it cannot be offered.
   */
  standing?: string;
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
  onApproveAlways: () => void;
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
          <p class="mt-0.5 text-sm leading-5 text-ink-muted [overflow-wrap:anywhere]">
            {asker()} asked the agent to {props.action}.
          </p>
          <Show when={props.canApprove && props.standing}>
            {(standing) => (
              <p class="mt-1 text-xs leading-4 text-ink-muted [overflow-wrap:anywhere]">
                Always allow lets {asker()} {standing()} in this session without
                asking you.
              </p>
            )}
          </Show>
        </div>
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
          <Show when={props.standing}>
            <Button
              type="button"
              size="md"
              variant="outline"
              disabled={props.disabled}
              onClick={() => props.onApproveAlways()}
            >
              Always allow
            </Button>
          </Show>
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

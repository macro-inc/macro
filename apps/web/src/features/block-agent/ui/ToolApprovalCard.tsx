import ShieldCheck from '@icon/system/regular/shield-check.svg';
import { Button, Card, Item } from '@ui';
import { type JSX, Show } from 'solid-js';

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
  /** The owner prompted the turn: a call they confirm even in their own. */
  ownTurn?: boolean;
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
  /** The section's accessible name; defaults to "Tool approval request". */
  ariaLabel?: string;
  /** Replaces the computed heading ("Approval needed", "Waiting for …"). */
  title?: string;
  /** Replaces the computed sentence about what the agent wants to do. */
  description?: string;
  /** Rendered under the sentence: what exactly is asked, notes, the code. */
  details?: JSX.Element;
  /**
   * Replaces the computed "Always allow lets …" note; `null` shows none even
   * where approving for good is offered.
   */
  standingNote?: JSX.Element | null;
  /** Button labels, for a caller whose surface is translated. */
  labels?: {
    decline?: string;
    approveAlways?: string;
    approve?: string;
    cancel?: string;
  };
};

/**
 * A tool call held for the session owner: approve or decline for them,
 * "waiting for the owner" with a way out for everyone else.
 */
export function ToolApprovalCard(props: ToolApprovalCardProps) {
  const asker = () =>
    props.ownTurn ? 'the agent' : (props.requester ?? 'A bot');
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label={props.ariaLabel ?? 'Tool approval request'}
      class="@container/card overflow-hidden text-ink"
    >
      <Card.Header class="pb-2">
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media>
            <ShieldCheck />
          </Item.Media>
          <Item.Content class="min-w-0 gap-0.5">
            <Card.Title>
              {props.title ??
                (props.canApprove
                  ? 'Approval needed'
                  : `Waiting for ${props.owner} to approve`)}
            </Card.Title>
            <Card.Description class="leading-5 [overflow-wrap:anywhere]">
              {props.description ??
                (props.ownTurn
                  ? `The agent wants to ${props.action}.`
                  : `${asker()} asked the agent to ${props.action}.`)}
            </Card.Description>
            {props.details}
            <Show
              when={props.standingNote === undefined}
              fallback={props.standingNote}
            >
              <Show when={props.canApprove && props.standing}>
                {(standing) => (
                  <Card.Metadata class="mt-0.5 leading-4 [overflow-wrap:anywhere]">
                    Always allow lets {asker()} {standing()} in this session
                    without asking you.
                  </Card.Metadata>
                )}
              </Show>
            </Show>
          </Item.Content>
        </Item>
      </Card.Header>
      <Card.Footer class="border-0 pt-0">
        <Show
          when={props.canApprove}
          fallback={
            <Show when={props.canCancel}>
              <Button
                type="button"
                size="md"
                variant="secondary"
                class="ml-auto"
                disabled={props.disabled}
                onClick={() => props.onCancel()}
              >
                {props.labels?.cancel ?? 'Cancel'}
              </Button>
            </Show>
          }
        >
          <Button
            type="button"
            size="md"
            variant="ghost"
            disabled={props.disabled}
            onClick={() => props.onDeny()}
          >
            {props.labels?.decline ?? 'Decline'}
          </Button>
          <Card.Actions class="ml-auto">
            <Show when={props.standing}>
              <Button
                type="button"
                size="md"
                variant="ghost"
                disabled={props.disabled}
                onClick={() => props.onApproveAlways()}
              >
                {props.labels?.approveAlways ?? 'Always allow'}
              </Button>
            </Show>
            <Button
              type="button"
              size="md"
              variant="secondary"
              disabled={props.disabled}
              onClick={() => props.onApprove()}
            >
              {props.labels?.approve ?? 'Approve'}
            </Button>
          </Card.Actions>
        </Show>
      </Card.Footer>
    </Card>
  );
}

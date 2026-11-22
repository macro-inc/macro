/**
 * A prompt whose send got no answer and that neither the log nor the queue
 * showed. It may have run, so its text is not put back in the box (a resend
 * could run it twice), and it is not dropped either: the card keeps it, with
 * a copy, and a resend only after saying it may run twice. It goes away when
 * the prompt's row reaches the log.
 */

import WarningCircle from '@icon/system/regular/warning-circle.svg';
import { Button, Card, Item } from '@ui';
import { createSignal, Show } from 'solid-js';

export interface UnconfirmedSendCardProps {
  /** The prompt's text as it was sent. */
  text: string;
  /** How many files rode it. */
  attachmentCount: number;
  onCopy: () => void;
  onSendAgain: () => void;
  onDismiss: () => void;
}

export function UnconfirmedSendCard(props: UnconfirmedSendCardProps) {
  const [confirming, setConfirming] = createSignal(false);
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label="Message not confirmed"
      class="mb-2 overflow-hidden text-ink"
    >
      <Card.Header class="pb-2">
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media class="text-failure">
            <WarningCircle />
          </Item.Media>
          <Item.Content class="gap-0.5">
            <Card.Title>Not confirmed</Card.Title>
            <Card.Description class="leading-5">
              We couldn't confirm this message was sent. Check the conversation
              before sending it again.
            </Card.Description>
            <p
              data-testid="unconfirmed-text"
              class="mt-1 line-clamp-3 text-sm text-ink wrap-anywhere"
            >
              {props.text}
            </p>
            <Show when={props.attachmentCount > 0}>
              <p class="text-xs text-ink-muted">
                {props.attachmentCount === 1
                  ? '1 file attached'
                  : `${props.attachmentCount} files attached`}
              </p>
            </Show>
          </Item.Content>
        </Item>
      </Card.Header>
      <Card.Footer class="flex-wrap justify-end gap-2 border-0 pt-0">
        <Show
          when={confirming()}
          fallback={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={props.onDismiss}
              >
                Dismiss
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={props.onCopy}
              >
                Copy
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(true)}
              >
                Send again
              </Button>
            </>
          }
        >
          <span class="mr-auto text-xs text-ink-muted">
            If the first one arrived, the agent gets it twice.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={props.onSendAgain}
          >
            Send anyway
          </Button>
        </Show>
      </Card.Footer>
    </Card>
  );
}

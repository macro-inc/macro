/**
 * A turn failure the person can act on, as a card: what happened, what to do,
 * and where to do it.
 *
 * The runtime classified the failure (a spent Cursor budget, say) and wrote
 * it in the person's terms, so this shows it as an instruction — the same
 * card shape as a permission request, in the failure ink — rather than as the
 * quiet rule an opaque runtime error gets.
 */

import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg';
import WarningCircle from '@icon/system/regular/warning-circle.svg';
import type { FailureNotice } from '@service-agent-fold/generated/types';
import { Button, Card, Item } from '@ui';
import { Show } from 'solid-js';

export interface FailureNoticeCardProps {
  notice: FailureNotice;
  /** Follows the notice's link; wired to the app's external-url handling. */
  onOpenLink: (url: string) => void;
}

export function FailureNoticeCard(props: FailureNoticeCardProps) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label={props.notice.title}
      class="overflow-hidden text-ink"
    >
      <Card.Header class={props.notice.link ? 'pb-2' : undefined}>
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media class="text-failure">
            <WarningCircle />
          </Item.Media>
          <Item.Content class="gap-0.5">
            <Card.Title>{props.notice.title}</Card.Title>
            <Card.Description class="leading-5 [overflow-wrap:anywhere]">
              {props.notice.body}
            </Card.Description>
          </Item.Content>
        </Item>
      </Card.Header>
      <Show when={props.notice.link}>
        {(link) => (
          <Card.Footer class="border-0 pt-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              class="ml-auto"
              onClick={() => props.onOpenLink(link().url)}
            >
              {link().label}
              <ArrowSquareOut class="size-4" />
            </Button>
          </Card.Footer>
        )}
      </Show>
    </Card>
  );
}

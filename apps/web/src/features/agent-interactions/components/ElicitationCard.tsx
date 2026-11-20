import ChatCircleDots from '@icon/system/regular/chat-circle-dots.svg';
import { Card, cn, Item } from '@ui';
import { type JSX, Show } from 'solid-js';

/** What a question card says about the question, apart from its controls. */
export type ElicitationHeader = {
  /** Who is asking, e.g. `Macro is asking`. */
  title: string;
  /** Where the question stands, e.g. `Waiting for you`. */
  status?: string;
  /** The agent's question. */
  message: string;
  /** Why the viewer's controls are inert, when they are. */
  notice?: string;
};

export type ElicitationCardProps = {
  header: ElicitationHeader;
  /** Placement on the card root, such as a height cap. */
  class?: string;
  /** What the question shows: a form's fields, a URL, a draft's composer. */
  children: JSX.Element;
  /** The decisions; omitted when the body carries its own (a composer). */
  actions?: JSX.Element;
};

/**
 * A question the agent is waiting on, framed like the session's other cards
 * (`ToolApprovalCard`): who asks and where it stands in the header, the
 * question and its fields in the body, the decisions in the footer.
 */
export function ElicitationCard(props: ElicitationCardProps) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label="Agent question"
      class={cn('overflow-hidden text-ink', props.class)}
    >
      <Card.Header class="pb-0">
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media>
            <ChatCircleDots />
          </Item.Media>
          <Item.Content class="gap-0.5">
            <Card.Title>{props.header.title}</Card.Title>
            <Show when={props.header.status}>
              {(status) => <Card.Description>{status()}</Card.Description>}
            </Show>
          </Item.Content>
        </Item>
      </Card.Header>
      <Card.Body class="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <p class="text-sm text-ink [overflow-wrap:anywhere]">{props.header.message}</p>
        <Show when={props.header.notice}>
          {(notice) => (
            <Card.Metadata class="leading-4">{notice()}</Card.Metadata>
          )}
        </Show>
        {props.children}
      </Card.Body>
      <Show when={props.actions}>
        <Card.Footer class="border-0 pt-0">{props.actions}</Card.Footer>
      </Show>
    </Card>
  );
}

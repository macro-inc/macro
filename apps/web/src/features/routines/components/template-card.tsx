import ClockCounterIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import { Badge, Button, Card } from '@ui';
import { For, Show } from 'solid-js';

/** A shared routine template as a card under the message that links it. */
export function TemplateCard(props: {
  name: string;
  description: string;
  authorName: string;
  triggers: readonly string[];
  activeCount: number;
  /** False for the author, whose own routine this is. */
  canActivate: boolean;
  onView(): void;
  onActivate(): void;
}) {
  return (
    <Card
      aria-label={`Routine template: ${props.name}`}
      class="mt-2 max-w-xl"
      role="article"
    >
      <Card.Header>
        <Card.Metadata class="flex flex-wrap items-center gap-2">
          <Badge variant="outline" size="xs">
            <ClockCounterIcon />
            Routine template
          </Badge>
          by {props.authorName}
        </Card.Metadata>
        <Card.Title>{props.name}</Card.Title>
        <Show when={props.description}>
          <Card.Description>{props.description}</Card.Description>
        </Show>
      </Card.Header>
      <Show when={props.triggers.length > 0}>
        <Card.Body class="flex flex-col gap-1 pt-0">
          <For each={props.triggers}>
            {(trigger) => (
              <div class="flex items-center gap-2">
                <LightningIcon class="size-4 shrink-0 text-ink-muted" />
                {trigger}
              </div>
            )}
          </For>
        </Card.Body>
      </Show>
      <Card.Footer>
        <span class="text-sm text-ink-muted">
          {props.activeCount === 1
            ? 'Active for 1 person'
            : `Active for ${props.activeCount} people`}
        </span>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => props.onView()}>
            View template
          </Button>
          <Show when={props.canActivate}>
            <Button variant="cta" size="sm" onClick={() => props.onActivate()}>
              Activate for me
            </Button>
          </Show>
        </div>
      </Card.Footer>
    </Card>
  );
}

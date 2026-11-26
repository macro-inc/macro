import ClockCounterIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import { Button, Card } from '@ui';
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
      variant="raised"
      aria-label={`Routine template: ${props.name}`}
      class="mt-2 max-w-xl"
      role="article"
    >
      <Card.Header>
        <Card.Metadata class="flex-nowrap items-start gap-x-1.5">
          <ClockCounterIcon class="size-4 shrink-0" />
          <span class="min-w-0 [overflow-wrap:anywhere]">
            Routine template by {props.authorName}
          </span>
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
        <Card.Metadata>
          {props.activeCount === 1
            ? 'Active for 1 person'
            : `Active for ${props.activeCount} people`}
        </Card.Metadata>
        <Card.Actions>
          <Button
            variant={props.canActivate ? 'ghost' : 'secondary'}
            size="sm"
            onClick={() => props.onView()}
          >
            View template
          </Button>
          <Show when={props.canActivate}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onActivate()}
            >
              Activate for me
            </Button>
          </Show>
        </Card.Actions>
      </Card.Footer>
    </Card>
  );
}

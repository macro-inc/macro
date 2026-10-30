import LightningIcon from '@icon/system/regular/lightning.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Button, Card } from '@ui';
import { For, type JSX } from 'solid-js';
import type { RoutineTemplate } from '../core/routine-templates';

/** A starter template, drawn like a shared routine template's card. */
function StarterCard(props: { template: RoutineTemplate; onUse(): void }) {
  return (
    <Card
      aria-label={`Routine template: ${props.template.title}`}
      class="min-w-0"
      role="article"
    >
      <Card.Header>
        <Card.Metadata>by Macro</Card.Metadata>
        <Card.Title>{props.template.title}</Card.Title>
      </Card.Header>
      <Card.Body class="flex items-center gap-2 pt-0 text-sm">
        <LightningIcon class="size-4 shrink-0 text-ink-muted" />
        {props.template.when}
      </Card.Body>
      <Card.Footer>
        <span class="min-w-0 truncate text-sm text-ink-muted">
          {props.template.description}
        </span>
        <Button variant="secondary" size="sm" onClick={() => props.onUse()}>
          Use template
        </Button>
      </Card.Footer>
    </Card>
  );
}

/**
 * Where a new routine starts: describe it for AI to draft, pick a template,
 * or start from scratch. Every path opens the editor to review.
 */
export function RoutineStart(props: {
  /** The description box; absent where AI drafting is unavailable. */
  describe?: JSX.Element;
  templates: RoutineTemplate[];
  onTemplate(template: RoutineTemplate): void;
  onBlank(): void;
}) {
  return (
    <div class="grid min-w-0 gap-5 pb-4">
      {props.describe}
      <section aria-label="Templates" class="grid min-w-0 gap-2.5">
        <h2 class="text-sm font-semibold text-ink">Templates</h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-2.5">
          <For each={props.templates}>
            {(template) => (
              <StarterCard
                template={template}
                onUse={() => props.onTemplate(template)}
              />
            )}
          </For>
        </div>
      </section>
      <Button
        variant="ghost"
        size="sm"
        class="w-fit"
        onClick={() => props.onBlank()}
      >
        <PlusIcon class="size-3.5" />
        Start from scratch
      </Button>
    </div>
  );
}

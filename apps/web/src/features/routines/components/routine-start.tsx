import LightningIcon from '@icon/system/regular/lightning.svg';
import { Button, Card } from '@ui';
import { For, type JSX } from 'solid-js';
import type { RoutineTemplate } from '../core/routine-templates';

/** A starter template, drawn like a shared routine template's card. */
function StarterCard(props: { template: RoutineTemplate; onUse(): void }) {
  return (
    <Card
      variant="filled"
      // Raised one step above the dialog's surface, as a card on it.
      depth={3}
      aria-label={`Routine template: ${props.template.title}`}
      class="min-w-0 gap-1.5 p-3"
      role="article"
    >
      <span class="text-xs text-ink-extra-muted">by Macro</span>
      <h3 class="text-sm font-medium text-ink">{props.template.title}</h3>
      <span class="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
        <LightningIcon class="size-3 shrink-0" aria-hidden="true" />
        <span class="truncate">{props.template.when}</span>
      </span>
      <div class="mt-1 flex min-w-0 items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-xs text-ink-muted">
          {props.template.description}
        </span>
        <Button
          variant="primary"
          size="xs"
          class="shrink-0"
          onClick={() => props.onUse()}
        >
          Activate for me
        </Button>
      </div>
    </Card>
  );
}

/**
 * Where a new routine starts: describe it for AI to draft, or pick a
 * template. Every path opens the editor to review.
 */
export function RoutineStart(props: {
  /** The description box; absent where AI drafting is unavailable. */
  describe?: JSX.Element;
  templates: RoutineTemplate[];
  onTemplate(template: RoutineTemplate): void;
}) {
  return (
    <div class="grid min-w-0 gap-5 pb-4">
      {props.describe}
      <section aria-label="Templates" class="grid min-w-0 gap-2.5">
        <h2 class="text-sm font-semibold text-ink">Templates</h2>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-2.5">
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
    </div>
  );
}

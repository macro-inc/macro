import { For, type JSX } from 'solid-js';
import type { RoutineTemplate } from '../core/routine-templates';
import { RoutineTemplateCard } from './routine-template-strip';

/**
 * Where a new routine starts: describe it for AI to draft, or pick a
 * template. Either opens the new routine's page to review before it's saved.
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
              <RoutineTemplateCard
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

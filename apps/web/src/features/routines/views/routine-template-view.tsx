import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import ClockCounterIcon from '@icon/system/regular/clock-counter-clockwise.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PlayIcon from '@icon/system/regular/play.svg';
import type { RoutineTemplate } from '@service-scheduled-action/generated/schemas';
import { Badge, Button, Layer } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { TemplateReferenceChip } from '../components/template-reference';
import { formatDateTime } from '../core/routine-draft';
import type { TemplateReference } from '../primitives/template-activation';

/**
 * A routine someone shared as a template, as the people it was shared with
 * see it. Nothing runs until they activate their own copy.
 */
export function RoutineTemplateView(props: {
  template: RoutineTemplate;
  authorName: string;
  /** False for the template's author, who already has the routine. */
  canActivate: boolean;
  triggers: readonly string[];
  references: readonly TemplateReference[];
  instructions: JSX.Element;
  onActivate(): void;
  onBack(): void;
}) {
  const decisions = () =>
    props.references.filter(
      (reference) =>
        reference.state === 'unavailable' || reference.state === 'choose'
    ).length;
  return (
    <ViewBreadcrumbs.Root
      value="template"
      onChange={(value) => {
        if (value === 'routines') props.onBack();
      }}
    >
      <ViewBreadcrumbs.Item value="routines" metadata={{}} order={0}>
        {(item) => (
          <ViewBreadcrumbs.ReturnButton
            onClick={item.onSelect}
            aria-label="Back to routines"
            tooltip="Routines"
          >
            Routines
          </ViewBreadcrumbs.ReturnButton>
        )}
      </ViewBreadcrumbs.Item>
      <ViewBreadcrumbs.Item value="template" metadata={{}} order={1}>
        {(item) => (
          <ViewBreadcrumbs.Button
            class="gap-1.5"
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={props.template.name}
          >
            <ClockCounterIcon class="size-3 shrink-0" />
            <span class="truncate">{props.template.name}</span>
          </ViewBreadcrumbs.Button>
        )}
      </ViewBreadcrumbs.Item>
      <div class="flex size-full min-h-0 min-w-0 flex-col text-ink">
        <ViewShell.TopBar
          class="touch:flex"
          aria-label="Routine template toolbar"
        >
          <ViewBreadcrumbs.Outlet
            aria-label="Routine template location"
            class="min-w-0"
          />
          <Show when={props.canActivate}>
            <Button
              variant="cta"
              size="md"
              class="ml-auto shrink-0"
              onClick={() => props.onActivate()}
            >
              <PlayIcon />
              Activate for me
            </Button>
          </Show>
        </ViewShell.TopBar>
        <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-12 touch:pt-6">
          <div class="mx-auto flex max-w-3xl flex-col gap-6">
            <div>
              <h1 class="text-2xl font-semibold">{props.template.name}</h1>
              <Show when={props.template.description}>
                <p class="mt-1 text-ink-muted">{props.template.description}</p>
              </Show>
              <div class="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline" size="sm">
                  <ClockCounterIcon />
                  Template by {props.authorName}
                </Badge>
                <Badge variant="outline" size="sm">
                  {props.template.active_count === 1
                    ? 'Active for 1 person'
                    : `Active for ${props.template.active_count} people`}
                </Badge>
                <Badge variant="outline" size="sm">
                  Updated {formatDateTime(props.template.updated_at)}
                </Badge>
              </div>
            </div>
            <Layer depth={1}>
              <section
                aria-label="Template triggers"
                class="rounded-xl border border-edge-muted bg-surface"
              >
                <div class="flex flex-col gap-2 p-4">
                  <For each={props.triggers}>
                    {(trigger) => (
                      <div class="flex items-center gap-2 text-sm">
                        <LightningIcon class="size-4 shrink-0 text-ink-muted" />
                        {trigger}
                      </div>
                    )}
                  </For>
                </div>
                <div class="flex items-center gap-2 border-t border-edge-muted px-4 py-3 text-xs text-ink-muted">
                  <span
                    aria-hidden="true"
                    class="size-1.5 rounded-full bg-ink-extra-muted"
                  />
                  Doesn't run until you activate it
                </div>
              </section>
            </Layer>
            <section aria-label="Template instructions">
              {props.instructions}
            </section>
            <Show when={props.references.length > 0}>
              <section
                aria-label="Template references"
                class="flex flex-col gap-2"
              >
                <h2 class="text-sm font-medium text-ink-muted">References</h2>
                <div class="flex flex-wrap gap-2">
                  <For each={props.references}>
                    {(reference) => (
                      <TemplateReferenceChip
                        variable={reference.variable}
                        state={reference.state}
                      />
                    )}
                  </For>
                </div>
                <p class="text-xs text-ink-muted">
                  Dashed references fill in as you.
                  <Show when={decisions() > 0}>
                    {' '}
                    Amber ones you can't open, so you'll decide what to do with
                    them.
                  </Show>
                </p>
              </section>
            </Show>
          </div>
        </div>
      </div>
    </ViewBreadcrumbs.Root>
  );
}

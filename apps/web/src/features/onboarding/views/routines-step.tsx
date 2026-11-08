import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { TraceFlow, usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import { ContinueButton, SkipButton } from '../components/controls';
import {
  RoutineSparkGlyph,
  RoutineSuggestionRow,
  SuggestionToggle,
} from '../components/routine-suggestion-row';
import { useOnboardingContext } from '../context/onboarding-context';
import { groupBySurface } from '../core/routine-suggestions';
import {
  createRoutinesStep,
  type RoutinesStep as RoutinesStepState,
  type ShownSuggestion,
} from '../primitives/routines-step';

function SuggestionSkeleton(props: { rows: number; label: string }) {
  return (
    <ListSkeleton.Root label={props.label}>
      {Array.from({ length: props.rows }, () => (
        <div class="flex items-start gap-3 p-3">
          <div class="skeleton-shimmer size-8 shrink-0 rounded-lg bg-skeleton" />
          <div class="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <ListSkeleton.Bar class="h-3 w-2/5" />
            <ListSkeleton.Bar class="w-4/5" />
            <ListSkeleton.Bar class="w-1/3" />
          </div>
        </div>
      ))}
    </ListSkeleton.Root>
  );
}

function SuggestionItem(props: {
  item: ShownSuggestion;
  step: RoutinesStepState;
  busy: boolean;
}) {
  const id = () => props.item.row.id;
  const status = () => props.step.statusFor(id());
  const edits = () => props.step.editsFor(props.item);
  return (
    <RoutineSuggestionRow
      row={props.item.row}
      edits={edits()}
      locked={status() === 'enabling' || status() === 'enabled'}
      failed={status() === 'failed'}
      expanded={props.step.isExpanded(id())}
      onExpandedChange={(expanded) => props.step.setExpanded(id(), expanded)}
      onEdit={(next) => props.step.edit(props.item, next)}
      action={
        <SuggestionToggle
          name={edits().name || props.item.row.title}
          on={props.step.isOn(id())}
          enabled={status() === 'enabled'}
          disabled={props.busy || status() === 'enabling'}
          onChange={(on) => props.step.setOn(id(), on)}
        />
      }
    />
  );
}

function StepBody(props: { finishing: boolean; onFinish(): void }) {
  const context = useOnboardingContext();
  const step = createRoutinesStep(context);
  usePending('routines.suggestions', step.waiting);
  const count = () => step.selectedCount();
  const busy = () => step.enabling() || props.finishing;
  const continueLabel = () => {
    if (props.finishing) return 'Opening your workspace…';
    if (step.enabling()) return 'Turning on routines…';
    if (count() === 0) return 'Continue to workspace';
    return `Turn on ${count()} ${count() === 1 ? 'routine' : 'routines'}`;
  };
  const forYou = () => {
    const view = step.view();
    return (
      view.kind === 'items' &&
      view.items.some((item) => item.row.byline.from === 'for_you')
    );
  };

  return (
    <section class="mx-auto flex w-full max-w-2xl flex-col py-2 sm:py-4">
      <header class="flex flex-col items-center text-center">
        <RoutineSparkGlyph size="lg" />
        <h1
          tabindex="-1"
          class="mt-5 font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          Put your busywork on autopilot.
        </h1>
        <p class="mx-auto mt-6 max-w-[440px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          <Show
            when={forYou()}
            fallback="Routines are AI agents that run on their own. Switch on the ones you want; you can change them any time."
          >
            Routines are AI agents that run on their own. We picked these from
            your inbox and tools. Switch on the ones you want; you can change
            them any time.
          </Show>
        </p>
      </header>
      <div class="mt-8 flex flex-col gap-6">
        <Switch>
          <Match
            when={(() => {
              const view = step.view();
              return view.kind === 'items' ? view : undefined;
            })()}
          >
            {(view) => (
              <>
                <For each={groupBySurface(view().items)}>
                  {(group) => (
                    <section aria-labelledby={`routine-group-${group.surface}`}>
                      <h2
                        id={`routine-group-${group.surface}`}
                        class="mb-1 px-3 text-xs font-medium tracking-wide text-ink-muted uppercase"
                      >
                        {group.label}
                      </h2>
                      <ul class="flex flex-col gap-1">
                        <For each={group.items}>
                          {(item) => (
                            <SuggestionItem
                              item={item}
                              step={step}
                              busy={busy()}
                            />
                          )}
                        </For>
                      </ul>
                    </section>
                  )}
                </For>
                <Show when={view().arriving}>
                  <div class="flex flex-col gap-2">
                    <p class="px-3 text-xs text-ink-muted" aria-live="polite">
                      Finding more routines for you…
                    </p>
                    <SuggestionSkeleton
                      rows={1}
                      label="Finding more routines"
                    />
                  </div>
                </Show>
              </>
            )}
          </Match>
          <Match when={step.view().kind === 'loading'}>
            <div class="flex flex-col gap-3">
              <p class="px-3 text-xs text-ink-muted" aria-live="polite">
                Studying your workspace to suggest routines that fit how you
                work…
              </p>
              <SuggestionSkeleton rows={3} label="Finding routines for you" />
            </div>
          </Match>
          <Match when={step.view().kind === 'error'}>
            <div
              role="alert"
              class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-muted"
            >
              Couldn't load suggestions.
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fireAndForget(step.refresh(), 'onboarding')}
              >
                <ArrowsClockwiseIcon class="size-4" aria-hidden="true" />
                Try again
              </Button>
            </div>
          </Match>
          <Match when={step.view().kind === 'empty'}>
            <div class="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-muted">
              <RoutineSparkGlyph />
              No routines to suggest yet. As your workspace grows, ideas show up
              in each sidebar.
            </div>
          </Match>
        </Switch>
      </div>
      <Show when={step.anyFailed()}>
        <p role="alert" class="mt-6 text-center text-sm text-failure">
          Some routines couldn't be turned on. Try again, or skip them for now.
        </p>
      </Show>
      <ContinueButton
        label={continueLabel()}
        disabled={busy()}
        onClick={() =>
          fireAndForget(step.turnOnAndFinish(props.onFinish), 'onboarding')
        }
      />
      <Show when={count() > 0}>
        <SkipButton
          disabled={busy()}
          onClick={() => step.skip(props.onFinish)}
        />
      </Show>
    </section>
  );
}

/**
 * Put busywork on autopilot: the routines AI picked from the inbox, shown
 * as they arrive, then Macro's templates; finishing turns on those left on.
 */
export function RoutinesStep(props: { finishing: boolean; onFinish(): void }) {
  return (
    <TraceFlow name="onboarding.routines" sampling="always">
      <StepBody finishing={props.finishing} onFinish={props.onFinish} />
    </TraceFlow>
  );
}

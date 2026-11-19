import { t } from '@app/lib/i18n';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import type { RoutineInput } from '@service-scheduled-action/generated/schemas';
import { Button } from '@ui';
import { type Accessor, For, Index, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { RoutineApp, SubRoutineDraft } from '../core/draft';
import { firstAgent } from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import { withSubRoutineSteps } from '../core/sub-routines';
import { ConnectionRows } from './routine-connections';
import { RoutineSurface } from './routine-editor';
import { RoutineSteps } from './routine-step-editor';
import type { RoutineStepSlots } from './routine-steps';

function inputType(input: RoutineInput): string {
  return match(input.type)
    .with('text', () => t('subRoutines.inputText'))
    .with('number', () => t('subRoutines.inputNumber'))
    .with('boolean', () => t('subRoutines.inputBoolean'))
    .exhaustive();
}

/** The values each copy of a definition is given, as chips. */
function DefinitionInputs(props: { inputs: RoutineInput[] }) {
  return (
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <span class="text-ink-muted">{t('subRoutines.definitionInputs')}</span>
      <For each={props.inputs}>
        {(input) => (
          <span class="inline-flex items-center gap-1 rounded-md border border-edge-muted px-1.5 py-0.5">
            <span class="text-ink">{input.label}</span>
            <span class="text-ink-extra-muted">{inputType(input)}</span>
          </span>
        )}
      </For>
    </div>
  );
}

/**
 * The work a routine's runs schedule once per item, each with its steps,
 * edited with the routine: a copy that hasn't run runs them as they are
 * when it runs. Each keeps its name, since the routine's code schedules it
 * by name, and its inputs, since that code passes them.
 */
export function SubRoutineDefinitions(props: {
  subRoutines: SubRoutineDraft[];
  onChange(subRoutines: SubRoutineDraft[]): void;
  defaultTarget: RoutineTarget;
  slots: RoutineStepSlots;
  connected: Accessor<ReadonlySet<string> | undefined>;
}) {
  // AI writes a step for the routine's own steps; a definition's code reads
  // inputs it doesn't know about, so its steps are changed by hand.
  const slots = () => ({ ...props.slots, createStepAuthor: undefined });
  return (
    <div class="grid min-w-0 gap-6">
      {/* By place, so a step edit doesn't remount the definition's editor. */}
      <Index each={props.subRoutines}>
        {(definition) => (
          <div
            role="group"
            aria-label={definition().title}
            class="grid min-w-0 gap-2"
          >
            <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 class="text-sm font-medium text-ink">{definition().title}</h3>
              <code class="text-xs text-ink-extra-muted">
                {definition().name}
              </code>
            </div>
            <Show when={definition().inputs.length > 0}>
              <DefinitionInputs inputs={definition().inputs} />
            </Show>
            <RoutineSteps
              steps={definition().steps}
              onChange={(steps) =>
                props.onChange(
                  withSubRoutineSteps(
                    props.subRoutines,
                    definition().name,
                    steps
                  )
                )
              }
              triggers={[]}
              defaultTarget={props.defaultTarget}
              slots={slots()}
            />
            <Show when={definition().apps.length}>
              <RoutineSurface>
                <ConnectionRows
                  apps={definition().apps}
                  agent={Boolean(firstAgent(definition().steps))}
                  connected={props.connected}
                  onChange={(apps: RoutineApp[]) =>
                    props.onChange(
                      props.subRoutines.map((item) =>
                        item.name === definition().name
                          ? { ...item, apps }
                          : item
                      )
                    )
                  }
                />
              </RoutineSurface>
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}

/**
 * A sub-routine's steps on its own page: its parent's definition, shown as
 * it will run, with the values this one was given. They are edited on the
 * parent's page.
 */
export function SubRoutineCopySteps(props: {
  title: string;
  /** Its parent's name, while the parent is there to open. */
  parentName?: string;
  /** Undefined while the parent loads, or when `missing` says why. */
  definition?: SubRoutineDraft;
  /**
   * Why a loaded parent shows no definition: it defines none by this name
   * any more, or it holds steps this page can't show.
   */
  missing?: 'gone' | 'hidden';
  values: { label: string; value: string }[];
  defaultTarget: RoutineTarget;
  slots: RoutineStepSlots;
  onOpenParent?(): void;
}) {
  return (
    <div class="grid min-w-0 gap-2">
      <RoutineSurface class="grid gap-3 px-6 py-4 text-sm @max-[600px]/routine:px-4">
        <p class="text-ink-muted">
          <Show
            when={props.parentName}
            fallback={t('subRoutines.copyStepsParentGone', {
              title: props.title,
            })}
          >
            {(parent) =>
              t('subRoutines.copySteps', {
                title: props.title,
                parent: parent(),
              })
            }
          </Show>
        </p>
        <Show when={props.values.length > 0}>
          <dl
            aria-label={t('subRoutines.copyValues')}
            class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1"
          >
            <For each={props.values}>
              {(item) => (
                <>
                  <dt class="text-ink-muted">{item.label}</dt>
                  <dd class="min-w-0 break-words text-ink">{item.value}</dd>
                </>
              )}
            </For>
          </dl>
        </Show>
        <Show when={props.parentName && props.onOpenParent}>
          <div class="min-w-0">
            {/* A long parent name truncates rather than overflow a phone. */}
            <Button
              variant="secondary"
              size="sm"
              class="max-w-full shrink"
              onClick={() => props.onOpenParent?.()}
            >
              <span class="min-w-0 truncate">
                {t('subRoutines.editInParent', {
                  parent: props.parentName ?? '',
                })}
              </span>
              <ArrowUpRightIcon class="size-3.5 shrink-0" />
            </Button>
          </div>
        </Show>
      </RoutineSurface>
      <Switch>
        <Match when={props.definition}>
          {(definition) => (
            <div role="group" aria-label={definition().title} class="min-w-0">
              <RoutineSteps
                steps={definition().steps}
                onChange={() => undefined}
                triggers={[]}
                defaultTarget={props.defaultTarget}
                slots={props.slots}
                readOnly
              />
            </div>
          )}
        </Match>
        <Match when={props.missing}>
          {(missing) => (
            <p class="text-sm text-ink-muted">
              {missing() === 'gone'
                ? t('subRoutines.copyDefinitionGone')
                : t('subRoutines.copyDefinitionHidden')}
            </p>
          )}
        </Match>
      </Switch>
    </div>
  );
}

import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import SlidersIcon from '@icon/system/regular/sliders-horizontal.svg';
import { Button, cn, TextField, ToggleSwitch } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createUniqueId, type JSX, Match, Show, Switch } from 'solid-js';
import type {
  RoutineSuggestion,
  SuggestionEdits,
  SuggestionStatus,
} from '../core/suggestions';
import { SuggestionIcon } from './suggestion-icon';

/**
 * One suggested routine: collapsed it reads as a title, a summary, and when
 * it runs, beside the host's action (Enable, or a toggle); expanded it lets
 * the user edit the name, instructions, and notifications first, or open the
 * full routine editor.
 */
export function RoutineSuggestionRow(props: {
  suggestion: RoutineSuggestion;
  edits: SuggestionEdits;
  status: SuggestionStatus;
  expanded: boolean;
  /** The control on the right, e.g. {@link SuggestionEnableButton}. */
  action: JSX.Element;
  /** Shown on pages that mix surfaces, such as Routines. */
  surfaceLabel?: string;
  onExpandedChange(expanded: boolean): void;
  onEdit(edits: SuggestionEdits): void;
  /** Opens the full routine editor; hidden where there is none. */
  onCustomize?: () => void;
}) {
  const detailsId = createUniqueId();
  // Edits apply to the routine still to be created.
  const locked = () =>
    props.status.kind === 'enabling' || props.status.kind === 'enabled';
  const edit = (patch: Partial<SuggestionEdits>) =>
    props.onEdit({ ...props.edits, ...patch });
  return (
    <li
      class={cn(
        'list-none rounded-xl border transition-colors',
        props.expanded
          ? 'border-edge-muted bg-control'
          : 'border-transparent not-touch:hover:bg-hover',
        props.status.kind === 'enabled' && 'border-success/30 bg-success-bg/40'
      )}
    >
      <div class="flex min-w-0 items-start gap-3 p-3">
        <SuggestionIcon name={props.suggestion.icon} class="mt-0.5" />
        <button
          type="button"
          class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={props.expanded}
          aria-controls={detailsId}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium text-ink">
              {props.edits.title || props.suggestion.title}
            </span>
            <Show when={props.surfaceLabel}>
              {(label) => (
                <span class="shrink-0 rounded-full bg-violet-bg px-1.5 text-[10px] leading-4 font-medium text-violet-ink">
                  {label()}
                </span>
              )}
            </Show>
            <CaretDownIcon
              aria-hidden="true"
              class={cn(
                'size-3.5 shrink-0 text-ink-extra-muted transition-transform',
                props.expanded && 'rotate-180'
              )}
            />
          </span>
          <span class="mt-0.5 block text-xs leading-5 text-ink-muted">
            {props.suggestion.summary}
          </span>
          <span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-extra-muted">
            <span class="flex items-center gap-1 text-violet-ink">
              <LightningIcon
                class="size-3.5"
                aria-hidden="true"
                data-icon-motion="none"
              />
              {props.suggestion.when}
            </span>
            <Show when={props.suggestion.reason}>
              <span class="min-w-0 truncate">{props.suggestion.reason}</span>
            </Show>
          </span>
        </button>
        <div class="flex shrink-0 items-center">{props.action}</div>
      </div>
      <Show when={props.status.kind === 'failed' && props.status}>
        {(failed) => (
          <p role="alert" class="px-3 pb-3 pl-14 text-xs text-failure">
            {failed().message}
          </p>
        )}
      </Show>
      <CollapseTransition open={props.expanded}>
        <div id={detailsId} class="flex flex-col gap-3 px-3 pb-3 pl-14">
          <TextField
            value={props.edits.title}
            onChange={(title) => edit({ title })}
            disabled={locked()}
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              Name
            </TextField.Label>
            <TextField.Input size="sm" />
          </TextField>
          <TextField
            value={props.edits.instructions}
            onChange={(instructions) => edit({ instructions })}
            disabled={locked()}
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              Instructions
            </TextField.Label>
            <TextField.TextArea autoResize />
          </TextField>
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <ToggleSwitch
              size="sm"
              label="Show each run in Home"
              labelClass="text-xs text-ink-muted"
              checked={props.edits.notify}
              disabled={locked()}
              onChange={(notify) => edit({ notify })}
            />
            <Show when={props.onCustomize && !locked() && props.onCustomize}>
              {(customize) => (
                <Button variant="ghost" size="sm" onClick={() => customize()()}>
                  <SlidersIcon aria-hidden="true" />
                  More options
                </Button>
              )}
            </Show>
          </div>
        </div>
      </CollapseTransition>
    </li>
  );
}

/** Enable in one click; once enabled, opens the routine. */
export function SuggestionEnableButton(props: {
  name: string;
  status: SuggestionStatus;
  onEnable(): void;
  onOpenRoutine(routineId: string): void;
}) {
  return (
    <Switch
      fallback={
        <Button
          variant="cta"
          size="sm"
          disabled={props.status.kind === 'enabling'}
          aria-label={`Enable ${props.name}`}
          onClick={() => props.onEnable()}
        >
          {props.status.kind === 'enabling' ? 'Enabling…' : 'Enable'}
        </Button>
      }
    >
      <Match when={props.status.kind === 'enabled' && props.status}>
        {(state) => (
          <Button
            variant="success"
            size="sm"
            onClick={() => props.onOpenRoutine(state().routineId)}
          >
            <CheckIcon aria-hidden="true" />
            Enabled
          </Button>
        )}
      </Match>
    </Switch>
  );
}

/** On or off, for lists where the host creates the chosen routines later. */
export function SuggestionToggle(props: {
  name: string;
  on: boolean;
  status: SuggestionStatus;
  onChange(on: boolean): void;
}) {
  return (
    <Show
      when={props.status.kind !== 'enabled'}
      fallback={
        <span class="flex items-center gap-1 text-xs font-medium text-success">
          <CheckIcon class="size-3.5" aria-hidden="true" />
          On
        </span>
      }
    >
      <ToggleSwitch
        size="md"
        label={<span class="sr-only">Turn on {props.name}</span>}
        checked={props.on}
        disabled={props.status.kind === 'enabling'}
        onChange={props.onChange}
      />
    </Show>
  );
}

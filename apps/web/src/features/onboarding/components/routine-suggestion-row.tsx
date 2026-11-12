import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CheckSquareIcon from '@icon/system/regular/check-square.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import PullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import LightningIcon from '@icon/system/regular/lightning.svg';
import PhoneIcon from '@icon/system/regular/phone.svg';
import RepeatIcon from '@icon/system/regular/repeat.svg';
import RobotIcon from '@icon/system/regular/robot.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import type { Surface } from '@service-scheduled-action/generated/schemas';
import { cn, TextField, ToggleSwitch } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createUniqueId, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  bylineText,
  type SuggestionEdits,
  type SuggestionRow,
} from '../core/routine-suggestions';

function surfaceIcon(surface: Surface) {
  return match(surface)
    .with('email', () => EnvelopeIcon)
    .with('calendar', () => CalendarIcon)
    .with('tasks', () => CheckSquareIcon)
    .with('files', () => FolderIcon)
    .with('crm', () => UsersIcon)
    .with('chat', () => ChatIcon)
    .with('calls', () => PhoneIcon)
    .with('reviews', () => PullRequestIcon)
    .with('agents', () => RobotIcon)
    .exhaustive();
}

/** The suggested-routines mark: the repeat icon on a flat violet tile. */
export function RoutineSparkGlyph(props: { size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden bg-violet-bg text-violet-ink ring-1 ring-violet/25 ring-inset',
        props.size === 'lg' ? 'size-11 rounded-xl' : 'size-8 rounded-lg'
      )}
    >
      <RepeatIcon class={props.size === 'lg' ? 'size-6' : 'size-4'} />
    </span>
  );
}

/**
 * One suggested routine: collapsed it reads as its name, what it does, when
 * it runs and who suggests it, beside its switch; expanded it lets the
 * person rename it and choose whether each run shows in Home first.
 */
export function RoutineSuggestionRow(props: {
  row: SuggestionRow;
  edits: SuggestionEdits;
  /** Created already, or being created: edits no longer apply. */
  locked: boolean;
  failed: boolean;
  expanded: boolean;
  /** The control on the right, e.g. {@link SuggestionToggle}. */
  action: JSX.Element;
  onExpandedChange(expanded: boolean): void;
  onEdit(edits: SuggestionEdits): void;
}) {
  const detailsId = createUniqueId();
  const edit = (patch: Partial<SuggestionEdits>) =>
    props.onEdit({ ...props.edits, ...patch });
  return (
    <li
      class={cn(
        'list-none rounded-xl border transition-colors',
        props.expanded
          ? 'border-edge-muted bg-control'
          : 'border-transparent not-touch:hover:bg-hover'
      )}
    >
      <div class="flex min-w-0 items-start gap-3 p-3">
        <span
          aria-hidden="true"
          class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-bg text-violet-ink"
        >
          <Dynamic component={surfaceIcon(props.row.surface)} class="size-4" />
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
          aria-expanded={props.expanded}
          aria-controls={detailsId}
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <span class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-medium text-ink">
              {props.edits.name || props.row.title}
            </span>
            <CaretDownIcon
              aria-hidden="true"
              class={cn(
                'size-3.5 shrink-0 text-ink-extra-muted transition-transform',
                props.expanded && 'rotate-180'
              )}
            />
          </span>
          <Show when={props.row.does}>
            <span class="mt-0.5 block text-xs leading-5 text-ink-muted">
              {props.row.does}
            </span>
          </Show>
          <span class="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-ink-extra-muted">
            <Show when={props.row.when}>
              {(when) => (
                <span class="flex items-center gap-1 text-violet-ink">
                  <LightningIcon class="size-3.5" aria-hidden="true" />
                  {when()}
                </span>
              )}
            </Show>
            <span class="min-w-0">{bylineText(props.row.byline)}</span>
          </span>
        </button>
        <div class="flex shrink-0 items-center">{props.action}</div>
      </div>
      <Show when={props.failed}>
        <p role="alert" class="px-3 pb-3 pl-14 text-xs text-failure">
          Couldn’t turn this on. Try again, or leave it off.
        </p>
      </Show>
      <CollapseTransition open={props.expanded}>
        <div id={detailsId} class="flex flex-col gap-3 px-3 pb-3 pl-14">
          <TextField
            value={props.edits.name}
            onChange={(name) => edit({ name })}
            disabled={props.locked}
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              Name
            </TextField.Label>
            <TextField.Input size="sm" />
          </TextField>
          <ToggleSwitch
            size="sm"
            label="Show each run in Home"
            labelClass="text-xs text-ink-muted"
            checked={props.edits.notify}
            disabled={props.locked}
            onChange={(notify) => edit({ notify })}
          />
        </div>
      </CollapseTransition>
    </li>
  );
}

/** On or off; finishing the step creates the ones that are on. */
export function SuggestionToggle(props: {
  name: string;
  on: boolean;
  enabled: boolean;
  disabled: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <Show
      when={!props.enabled}
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
        disabled={props.disabled}
        onChange={props.onChange}
      />
    </Show>
  );
}

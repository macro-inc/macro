import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { deepEqual } from '@core/util/compareUtils';
import PlusIcon from '@icon/system/regular/plus.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, cn, RadioGroup, TextField } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import {
  type Knob,
  knobIsEmpty,
  knobText,
  knobValueProblem,
  type SentencePart,
  sentenceParts,
  type UnusableItem,
  unusableReason,
} from '../core/knobs';
import {
  KnobEntityPicker,
  KnobEntitySheet,
  KnobEntityValue,
} from './routine-knob-entity';
import { menuMount } from './routine-search-menu';

type KnobChange = (name: string, value: Knob['value']) => void;

// Positioned, so a value stays clickable on a card whose whole face is a button.
const VALUE =
  'relative inline rounded-sm px-0.5 font-medium text-accent underline decoration-2 underline-offset-4 outline-none hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-edge-muted';
const QUESTION =
  'relative inline rounded-sm px-0.5 text-ink underline decoration-accent decoration-dotted decoration-2 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-edge-muted';

/** How large a sentence reads: the routine page's, or a card's. */
export type SentenceSize = 'md' | 'sm' | 'xs';

/**
 * What a code step does, in its owner's words, with each knob's value in
 * place: values underlined, and what AI decides dotted. Each opens to be
 * changed without new code.
 */
export function StepSentence(props: {
  sentence: string;
  knobs: Knob[];
  onKnob: KnobChange;
  /** `md` on the routine page; `sm` and `xs` on cards. */
  size?: SentenceSize;
  /** Placement only, e.g. a fixed height on a card. */
  class?: string;
  /** Picked items its owner can't use now; their knobs need a new pick. */
  unusable?: readonly UnusableItem[];
}) {
  const parts = () => sentenceParts(props.sentence, props.knobs);
  return (
    <Show when={parts()}>
      {(parts) => (
        <p
          class={cn(
            'text-ink-muted',
            props.size === 'sm'
              ? 'text-[13px] leading-[22px]'
              : props.size === 'xs'
                ? 'text-xs leading-[19px]'
                : 'text-[15px] leading-7',
            props.class
          )}
        >
          <For each={parts()}>
            {(part) => (
              <SentencePiece
                part={part}
                onKnob={props.onKnob}
                compact={props.size === 'sm' || props.size === 'xs'}
                unusable={props.unusable}
              />
            )}
          </For>
        </p>
      )}
    </Show>
  );
}

function SentencePiece(props: {
  part: SentencePart;
  onKnob: KnobChange;
  compact: boolean;
  unusable: readonly UnusableItem[] | undefined;
}) {
  return (
    <Switch>
      <Match when={props.part.kind === 'text' && props.part}>
        {(part) => part().text}
      </Match>
      <Match when={props.part.kind === 'knob' && props.part}>
        {(part) => (
          <KnobControl
            knob={part().knob}
            compact={props.compact}
            unusable={props.unusable}
            onChange={(value) => props.onKnob(part().knob.name, value)}
          />
        )}
      </Match>
    </Switch>
  );
}

/** Knobs the sentence doesn't show, as a list of settings. */
export function KnobSettings(props: {
  knobs: Knob[];
  onKnob: KnobChange;
  /** Picked items its owner can't use now; their knobs need a new pick. */
  unusable?: readonly UnusableItem[];
}) {
  return (
    <dl class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 text-sm">
      <For each={props.knobs}>
        {(knob) => (
          <>
            <dt class="min-w-0 text-ink-muted">
              {knob.type === 'question' ? 'AI decides whether' : knob.label}
            </dt>
            <dd class="min-w-0 text-right">
              <KnobControl
                knob={knob}
                // The label is beside it already.
                emptyText="Not set"
                unusableText="Needs a new pick"
                unusable={props.unusable}
                onChange={(value) => props.onKnob(knob.name, value)}
              />
            </dd>
          </>
        )}
      </For>
    </dl>
  );
}

/**
 * One knob's value: on/off flips in place, and the rest open an editor whose
 * change applies only on Save.
 */
function KnobControl(props: {
  knob: Knob;
  /** In a card's smaller sentence: a thinner, closer underline. */
  compact?: boolean;
  /** What a knob with no value shows; its label by default. */
  emptyText?: string;
  unusableText?: string;
  unusable?: readonly UnusableItem[];
  onChange(value: Knob['value']): void;
}) {
  return (
    <Show
      when={props.knob.type === 'boolean' && props.knob}
      fallback={
        <KnobPopover
          knob={props.knob}
          compact={props.compact}
          emptyText={props.emptyText}
          unusableText={props.unusableText}
          unusable={unusableReason(props.knob, props.unusable ?? [])}
          onChange={props.onChange}
        />
      }
    >
      {(knob) => (
        <button
          type="button"
          class={cn(
            VALUE,
            props.compact && 'px-px decoration-[1.5px] underline-offset-3'
          )}
          aria-pressed={knob().value}
          aria-label={`${knob().label}: ${knob().value ? 'on' : 'off'}`}
          onClick={() => props.onChange(!knob().value)}
        >
          {knobText(knob())}
        </button>
      )}
    </Show>
  );
}

/** A knob's value with nothing in it: no text, no number, or no item. */
function blankValue(knob: Knob): Knob['value'] {
  if (knob.type === 'number') return Number.NaN;
  if (knob.type === 'entity') return null;
  return '';
}

function isBlank(value: Knob['value']) {
  return (
    value === null ||
    value === '' ||
    (typeof value === 'number' && Number.isNaN(value))
  );
}

/** An item knob's draft: the item, or none. */
function entityDraft(value: Knob['value']) {
  return typeof value === 'object' ? value : null;
}

/**
 * A knob's value, opening its editor. The editor changes a draft: Clear
 * empties it, Save applies it, and Cancel, Escape or a click away drop it.
 * Enter never saves, so a stray one can't apply a half-typed value. On
 * touch, an item knob picks in a sheet, whose Done saves.
 */
function KnobPopover(props: {
  knob: Knob;
  compact?: boolean;
  emptyText?: string;
  /** Why its picked item needs a new pick, when it does. */
  unusable?: string;
  /** What it shows while it needs a new pick; its label by default. */
  unusableText?: string;
  onChange(value: Knob['value']): void;
}) {
  const empty = () => knobIsEmpty(props.knob);
  const needsPick = () => !empty() && props.unusable !== undefined;
  const [open, setOpen] = createSignal(false);
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const inSheet = () => props.knob.type === 'entity' && isTouchDevice();
  const [draft, setDraft] = createSignal<Knob['value']>(props.knob.value);
  // The draft still names the item that can't be used: say why, and don't
  // save it again.
  const stale = () =>
    needsPick() && deepEqual(draft(), props.knob.value)
      ? props.unusable
      : undefined;
  const problem = () => knobValueProblem(props.knob, draft()) ?? stale();
  let trigger: HTMLElement | undefined;
  let editor: HTMLDivElement | undefined;
  const close = () => {
    setOpen(false);
    setSheetOpen(false);
  };
  const save = () => {
    if (problem()) return;
    if (!deepEqual(draft(), props.knob.value)) props.onChange(draft());
    close();
  };
  // The field keeps focus, so typing can start again at once.
  const clear = () => {
    setDraft(blankValue(props.knob));
    editor?.querySelector<HTMLElement>('input, textarea')?.focus();
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        // Each opening starts from the saved value.
        if (next) setDraft(props.knob.value);
        if (next && inSheet()) setSheetOpen(true);
        else setOpen(next);
      }}
      placement="bottom-start"
      gutter={6}
    >
      <Popover.Trigger
        ref={trigger}
        // Inline, so a long question wraps with the sentence; a button
        // would move it whole onto its own line.
        as="span"
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).click();
        }}
        // A sheet's search field keeps the keyboard.
        onPointerDown={(event: PointerEvent) => {
          if (inSheet()) event.preventDefault();
        }}
        onMouseDown={(event: MouseEvent) => {
          if (inSheet()) event.preventDefault();
        }}
        class={cn(
          'cursor-pointer',
          props.knob.type === 'question' ? QUESTION : VALUE,
          // Still to fill in: dashed, as a template reference that fills in.
          (empty() || needsPick()) && 'decoration-dashed',
          // Picked, but gone or out of reach: its steps fail until repicked.
          needsPick() && 'text-failure hover:text-failure',
          props.compact && 'px-px decoration-[1.5px] underline-offset-3'
        )}
        aria-label={
          props.knob.type === 'question'
            ? `AI decides whether ${props.knob.label}. Change the question`
            : empty()
              ? `${props.knob.label}: not set. Set it`
              : needsPick()
                ? `${props.knob.label}: needs a new pick. Set it`
                : `${props.knob.label}: ${knobText(props.knob)}. Change it`
        }
      >
        <Switch fallback={knobText(props.knob)}>
          <Match when={props.knob.type === 'question'}>
            <SparkleIcon class="mr-1 inline size-3.5 align-[-2px] text-accent" />
            {knobText(props.knob)}
          </Match>
          <Match when={empty()}>
            <PlusIcon class="mr-0.5 inline size-3.5 align-[-2px]" />
            {props.emptyText ?? props.knob.label}
          </Match>
          <Match when={needsPick()}>
            <PlusIcon class="mr-0.5 inline size-3.5 align-[-2px]" />
            {props.unusableText ?? props.knob.label}
          </Match>
          <Match when={props.knob.type === 'entity' && props.knob}>
            {(knob) => <KnobEntityValue knob={knob()} />}
          </Match>
        </Switch>
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content
          class={cn(
            'menu-surface z-modal flex max-h-[var(--kb-popper-content-available-height)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-3',
            props.knob.type === 'text' ||
              props.knob.type === 'question' ||
              props.knob.type === 'entity'
              ? 'w-80'
              : 'w-auto min-w-64'
          )}
          onKeyDown={(event) => event.stopPropagation()}
          // A choice opens on its picked option, not the first one, so
          // Space and the arrows start from it.
          onOpenAutoFocus={(event) => {
            // An item's picker opens on its search instead.
            if (props.knob.type !== 'choice') return;
            const picked = editor?.querySelector<HTMLElement>(
              'input[type="radio"]:checked'
            );
            if (!picked) return;
            event.preventDefault();
            picked.focus();
          }}
        >
          <div ref={editor} class="flex min-h-0 flex-col gap-3">
            {/* Only the field scrolls, so Save stays in reach; its padding
                keeps focus rings inside the scroller. */}
            <div class="-m-1 min-h-0 overflow-y-auto p-1">
              <KnobEditor
                knob={props.knob}
                value={draft()}
                problem={problem()}
                onInput={setDraft}
                onCancel={close}
              />
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isBlank(draft())}
                onClick={clear}
              >
                Clear
              </Button>
              <Popover.CloseButton
                as={Button}
                type="button"
                variant="ghost"
                size="sm"
                class="ml-auto"
              >
                Cancel
              </Popover.CloseButton>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!!problem()}
                onClick={save}
              >
                Save
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
      <Show when={inSheet() && props.knob.type === 'entity' && props.knob}>
        {(knob) => (
          <KnobEntitySheet
            knob={knob()}
            open={sheetOpen()}
            value={entityDraft(draft())}
            problem={problem()}
            notice={stale()}
            onInput={setDraft}
            onCancel={close}
            onSave={save}
          />
        )}
      </Show>
    </Popover>
  );
}

/** The numbers a knob takes, in words, or undefined when any number does. */
function numberRange(knob: { min?: number; max?: number }) {
  if (knob.min !== undefined && knob.max !== undefined)
    return `${knob.min} to ${knob.max}`;
  if (knob.min !== undefined) return `${knob.min} or more`;
  if (knob.max !== undefined) return `${knob.max} or less`;
  return undefined;
}

/** The field that edits one knob, by its kind. */
function KnobEditor(props: {
  knob: Knob;
  value: Knob['value'];
  problem: string | undefined;
  onInput(value: Knob['value']): void;
  /** Escape in a search inside it. */
  onCancel(): void;
}) {
  const invalid = () => (props.problem ? 'invalid' : 'valid');
  return (
    <Switch>
      <Match when={props.knob.type === 'number' && props.knob}>
        {(knob) => {
          const value = () =>
            typeof props.value === 'number' ? props.value : Number.NaN;
          // One more or fewer, kept in range.
          const step = (by: number) => {
            const next = (Number.isFinite(value()) ? value() : 0) + by;
            props.onInput(
              Math.min(
                knob().max ?? Number.POSITIVE_INFINITY,
                Math.max(knob().min ?? Number.NEGATIVE_INFINITY, next)
              )
            );
          };
          return (
            <TextField
              class="grid gap-1.5"
              value={Number.isFinite(value()) ? String(value()) : ''}
              validationState={invalid()}
              onChange={(text) =>
                props.onInput(text.trim() === '' ? Number.NaN : Number(text))
              }
            >
              <TextField.Label class="text-xs font-medium text-ink-muted">
                {knob().label}
              </TextField.Label>
              <div class="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="One fewer"
                  disabled={value() <= (knob().min ?? Number.NEGATIVE_INFINITY)}
                  onClick={() => step(-1)}
                >
                  −
                </Button>
                <TextField.Input
                  type="number"
                  inputMode="decimal"
                  class="w-20 text-center"
                  min={knob().min}
                  max={knob().max}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="One more"
                  disabled={value() >= (knob().max ?? Number.POSITIVE_INFINITY)}
                  onClick={() => step(1)}
                >
                  +
                </Button>
                <Show when={numberRange(knob())}>
                  {(range) => (
                    <TextField.Description class="pl-1 text-xs text-ink-muted">
                      {range()}
                    </TextField.Description>
                  )}
                </Show>
              </div>
              <TextField.ErrorMessage class="text-xs text-failure">
                {props.problem}
              </TextField.ErrorMessage>
            </TextField>
          );
        }}
      </Match>
      <Match when={props.knob.type === 'question' && props.knob}>
        {(knob) => (
          <TextField
            class="grid gap-1.5"
            value={String(props.value)}
            validationState={invalid()}
            onChange={props.onInput}
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              What AI is asked
            </TextField.Label>
            <TextField.TextArea autoResize rows={3} />
            <TextField.Description class="text-xs leading-4 text-ink-muted">
              A yes means {knob().label}.
            </TextField.Description>
            <TextField.ErrorMessage class="text-xs text-failure">
              {props.problem}
            </TextField.ErrorMessage>
          </TextField>
        )}
      </Match>
      <Match when={props.knob.type === 'text' && props.knob}>
        {(knob) => (
          <TextField
            class="grid gap-1.5"
            value={String(props.value)}
            validationState={invalid()}
            onChange={props.onInput}
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              {knob().label}
            </TextField.Label>
            <TextField.Input />
            <TextField.ErrorMessage class="text-xs text-failure">
              {props.problem}
            </TextField.ErrorMessage>
          </TextField>
        )}
      </Match>
      <Match when={props.knob.type === 'choice' && props.knob}>
        {(knob) => (
          <RadioGroup
            class="text-sm text-ink"
            // Cleared, no option is picked.
            value={typeof props.value === 'string' ? props.value : ''}
            validationState={invalid()}
            onChange={props.onInput}
          >
            <RadioGroup.Label class="text-xs font-medium text-ink-muted">
              {knob().label}
            </RadioGroup.Label>
            <For each={knob().options}>
              {(option) => (
                <RadioGroup.Item value={option} class="touch:min-h-11">
                  <RadioGroup.ItemControl />
                  <RadioGroup.ItemLabel class="flex flex-1 items-center self-stretch">
                    {option}
                  </RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
            <RadioGroup.ErrorMessage class="text-xs text-failure">
              {props.problem}
            </RadioGroup.ErrorMessage>
          </RadioGroup>
        )}
      </Match>
      <Match when={props.knob.type === 'entity' && props.knob}>
        {(knob) => (
          <KnobEntityPicker
            knob={knob()}
            value={entityDraft(props.value)}
            problem={props.problem}
            onInput={props.onInput}
            onCancel={props.onCancel}
          />
        )}
      </Match>
    </Switch>
  );
}

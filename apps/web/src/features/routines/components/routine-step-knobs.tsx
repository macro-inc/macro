import CheckIcon from '@icon/system/regular/check.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Popover } from '@kobalte/core/popover';
import { Button, Dropdown, TextField } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import {
  type Knob,
  knobText,
  knobValueProblem,
  type SentencePart,
  sentenceParts,
} from '../core/knobs';
import { menuMount } from './routine-search-menu';

type KnobChange = (name: string, value: Knob['value']) => void;

const VALUE =
  'inline rounded-sm px-0.5 font-medium text-accent underline decoration-2 underline-offset-4 outline-none hover:text-accent-ink focus-visible:ring-2 focus-visible:ring-edge-muted';
const QUESTION =
  'inline rounded-sm px-0.5 text-ink underline decoration-accent decoration-dotted decoration-2 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-edge-muted';

/**
 * What a code step does, in its owner's words, with each knob's value in
 * place: values underlined, and what AI decides dotted. Each opens to be
 * changed without new code.
 */
export function StepSentence(props: {
  sentence: string;
  knobs: Knob[];
  onKnob: KnobChange;
}) {
  const parts = () => sentenceParts(props.sentence, props.knobs);
  return (
    <Show when={parts()}>
      {(parts) => (
        <p class="text-base leading-8 text-ink-muted">
          <For each={parts()}>
            {(part) => <SentencePiece part={part} onKnob={props.onKnob} />}
          </For>
        </p>
      )}
    </Show>
  );
}

function SentencePiece(props: { part: SentencePart; onKnob: KnobChange }) {
  return (
    <Switch>
      <Match when={props.part.kind === 'text' && props.part}>
        {(part) => part().text}
      </Match>
      <Match when={props.part.kind === 'knob' && props.part}>
        {(part) => (
          <KnobControl
            knob={part().knob}
            onChange={(value) => props.onKnob(part().knob.name, value)}
          />
        )}
      </Match>
    </Switch>
  );
}

/** Knobs the sentence doesn't show, as a list of settings. */
export function KnobSettings(props: { knobs: Knob[]; onKnob: KnobChange }) {
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
 * One knob's value: on/off flips in place, a choice opens a menu that saves
 * the option picked, and the rest open an editor.
 */
function KnobControl(props: {
  knob: Knob;
  onChange(value: Knob['value']): void;
}) {
  return (
    <Switch
      fallback={<KnobPopover knob={props.knob} onChange={props.onChange} />}
    >
      <Match when={props.knob.type === 'choice' && props.knob}>
        {(knob) => <KnobChoiceMenu knob={knob()} onChange={props.onChange} />}
      </Match>
      <Match when={props.knob.type === 'boolean' && props.knob}>
        {(knob) => (
          <button
            type="button"
            class={VALUE}
            aria-pressed={knob().value}
            aria-label={`${knob().label}: ${knob().value ? 'on' : 'off'}`}
            onClick={() => props.onChange(!knob().value)}
          >
            {knobText(knob())}
          </button>
        )}
      </Match>
    </Switch>
  );
}

function KnobChoiceMenu(props: {
  knob: Extract<Knob, { type: 'choice' }>;
  onChange(value: Knob['value']): void;
}) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  return (
    <Dropdown
      open={open()}
      onOpenChange={setOpen}
      placement="bottom-start"
      modal={false}
    >
      {/* The menu's own trigger, so the value stays an underlined word. */}
      <DropdownMenu.Trigger
        ref={trigger}
        class={VALUE}
        aria-label={`${props.knob.label}: ${props.knob.value}. Change it`}
      >
        {props.knob.value}
      </DropdownMenu.Trigger>
      <Dropdown.Content
        portalScope="local"
        mount={menuMount(trigger)}
        class="min-w-44"
      >
        <Dropdown.Group>
          <Dropdown.GroupLabel>{props.knob.label}</Dropdown.GroupLabel>
          <Dropdown.RadioGroup
            value={props.knob.value}
            onChange={(value) => {
              setOpen(false);
              if (value !== props.knob.value) props.onChange(value);
            }}
          >
            <For each={props.knob.options}>
              {(option) => (
                <Dropdown.RadioItem value={option}>
                  <span class="flex-1">{option}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function KnobPopover(props: {
  knob: Knob;
  onChange(value: Knob['value']): void;
}) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<Knob['value']>(props.knob.value);
  const problem = () => knobValueProblem(props.knob, draft());
  let trigger: HTMLButtonElement | undefined;
  const save = () => {
    if (problem()) return;
    props.onChange(draft());
    setOpen(false);
  };
  return (
    <Popover
      open={open()}
      onOpenChange={(next) => {
        // Each opening starts from the saved value.
        if (next) setDraft(props.knob.value);
        setOpen(next);
      }}
      placement="bottom-start"
      gutter={6}
    >
      <Popover.Trigger
        ref={trigger}
        class={props.knob.type === 'question' ? QUESTION : VALUE}
        aria-label={
          props.knob.type === 'question'
            ? `AI decides whether ${props.knob.label}. Change the question`
            : `${props.knob.label}: ${knobText(props.knob)}. Change it`
        }
      >
        <Show when={props.knob.type === 'question'}>
          <SparkleIcon class="mr-1 inline size-3.5 align-[-2px] text-accent" />
        </Show>
        {knobText(props.knob)}
      </Popover.Trigger>
      <Popover.Portal mount={menuMount(trigger)}>
        <Popover.Content
          class="menu-surface z-modal w-80 max-w-[calc(100vw-1rem)] p-3"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <form
            class="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <KnobEditor
              knob={props.knob}
              value={draft()}
              problem={problem()}
              onInput={setDraft}
            />
            <div class="flex justify-end gap-2">
              <Popover.CloseButton
                as={Button}
                type="button"
                variant="ghost"
                size="sm"
              >
                Cancel
              </Popover.CloseButton>
              <Button type="submit" size="sm" disabled={!!problem()}>
                Save
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

/** The field that edits one knob, by its kind. */
function KnobEditor(props: {
  knob: Knob;
  value: Knob['value'];
  problem: string | undefined;
  onInput(value: Knob['value']): void;
}) {
  const invalid = () => (props.problem ? 'invalid' : 'valid');
  return (
    <Switch>
      <Match when={props.knob.type === 'number' && props.knob}>
        {(knob) => (
          <TextField
            class="grid gap-1.5"
            value={String(props.value)}
            validationState={invalid()}
            onChange={(value) =>
              props.onInput(value.trim() === '' ? Number.NaN : Number(value))
            }
          >
            <TextField.Label class="text-xs font-medium text-ink-muted">
              {knob().label}
            </TextField.Label>
            <TextField.Input
              type="number"
              inputMode="decimal"
              min={knob().min}
              max={knob().max}
            />
            <TextField.ErrorMessage class="text-xs text-failure">
              {props.problem}
            </TextField.ErrorMessage>
          </TextField>
        )}
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
    </Switch>
  );
}

import type { Accessor, JSX } from 'solid-js';

/** The selection actions of Source MarkdownPopupToolbar. */
export type BodyPopupSlotId = 'ai' | 'task' | 'link';

/** What a slot's toolbar button can do. */
export interface BodyPopupButtonControl {
  /** Enter this slot's prompt (capture runs first); a no-op without one. */
  open(): void;
  /** Hide the popup without a prompt (Source setPopupVisible(false) after a
   *  button-only action such as Create task). */
  close(): void;
}

/** The two ways out of a prompt. */
export interface BodyPopupPromptExits {
  /** Submit exit: leave the prompt and hide the popup (Source
   *  handleInsertLink / handleAiEditSubmit). */
  close(): void;
  /** Escape exit: back to the toolbar and refocus the editor (Source
   *  dismissPrompt). */
  dismiss(): void;
}

/** What a slot's prompt can do, with the value its capture returned. */
export interface BodyPopupPromptControl<Captured> extends BodyPopupPromptExits {
  readonly value: Captured;
}

/** A slot whose button or FormatTools opens a prompt replacing the toolbar.
 *  `capture` runs on open, before the prompt takes focus. */
export interface BodyPopupPromptSlotSpec<Captured> {
  readonly id: BodyPopupSlotId;
  readonly available: Accessor<boolean>;
  button?(control: BodyPopupButtonControl): JSX.Element;
  capture(): Captured;
  prompt(control: BodyPopupPromptControl<Captured>): JSX.Element;
  /** Any prompt was dismissed (Source dismissPrompt clears every prompt's
   *  input, not only the open one's). */
  dismissed?(): void;
  /** The touch toolbar's option for this slot (Source TouchSelectionToolbar
   *  onEditWithAi / onCreateTask); `hide` hides the popup. */
  select?(hide: () => void): void;
}

/** A slot with only a button. */
export interface BodyPopupButtonSlotSpec {
  readonly id: BodyPopupSlotId;
  readonly available: Accessor<boolean>;
  button(control: BodyPopupButtonControl): JSX.Element;
  select?(hide: () => void): void;
  /** The touch option's exact Source label (Task: createTaskLabel); a
   *  touch-selectable slot without one is not offered on touch. */
  readonly touchLabel?: Accessor<string>;
  /** Source isConverting for the Task option. */
  readonly converting?: Accessor<boolean>;
}

/** A prompt opened by `open`: its capture already taken. */
export type BodyPopupOpenedPrompt = (
  exits: BodyPopupPromptExits
) => JSX.Element;

/** What the toolbar holds. Each slot's capture and prompt are paired in a
 *  closure, so slots with different captured types share one list. */
export interface BodyPopupSlot {
  readonly id: BodyPopupSlotId;
  readonly available: Accessor<boolean>;
  button?(control: BodyPopupButtonControl): JSX.Element;
  open?(): BodyPopupOpenedPrompt;
  dismissed?(): void;
  select?(hide: () => void): void;
  readonly touchLabel?: Accessor<string>;
  readonly converting?: Accessor<boolean>;
}

export function promptSlot<Captured>(
  spec: BodyPopupPromptSlotSpec<Captured>
): BodyPopupSlot {
  return {
    id: spec.id,
    available: spec.available,
    button: spec.button,
    dismissed: spec.dismissed,
    select: spec.select,
    open: () => {
      const value = spec.capture();
      return (exits) =>
        spec.prompt({ value, close: exits.close, dismiss: exits.dismiss });
    },
  };
}

export function buttonSlot(spec: BodyPopupButtonSlotSpec): BodyPopupSlot {
  return {
    id: spec.id,
    available: spec.available,
    button: spec.button,
    select: spec.select,
    touchLabel: spec.touchLabel,
    converting: spec.converting,
  };
}

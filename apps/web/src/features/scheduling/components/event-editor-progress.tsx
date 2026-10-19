import Check from '@phosphor/check.svg';
import { Dropdown } from '@ui';
import { For, onCleanup, Show } from 'solid-js';
import { EVENT_EDITOR_STEPS, type EventEditorStep } from '../core/event-editor';

/** A visual and accessible progress indicator for the booking-link editor. */
export function EventEditorProgress(props: { step: number }) {
  const currentStep = () => EVENT_EDITOR_STEPS[props.step];
  const position = () => props.step + 1;
  const total = EVENT_EDITOR_STEPS.length;
  return (
    <div
      role="progressbar"
      aria-label="Booking setup progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={position()}
      aria-valuetext={`Step ${position()} of ${total}: ${currentStep().heading}`}
      aria-live="polite"
      aria-atomic="true"
      class="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-active sm:w-20"
    >
      <div
        aria-hidden="true"
        class="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
        style={{ width: `${(position() / total) * 100}%` }}
      />
    </div>
  );
}

/** The current step number opens the editor's step navigation menu. */
export function EventEditorStepMenu(props: {
  step: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  onStep: (step: EventEditorStep) => void;
}) {
  let pendingStep: EventEditorStep | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      fitViewport
      overflowPadding={16}
    >
      <Dropdown.Trigger
        type="button"
        variant="ghost"
        size="icon-md"
        glass={false}
        label="Jump to step"
        aria-label={`Jump to step, current step ${props.step + 1} of ${EVENT_EDITOR_STEPS.length}`}
        disabled={props.disabled}
        class="text-xl font-medium leading-snug tracking-wide text-ink"
      >
        {props.step + 1}
      </Dropdown.Trigger>
      <Dropdown.Content
        portalScope="local"
        class="min-w-64 max-w-[calc(100vw-32px)] max-h-[min(var(--kb-popper-content-available-height),calc(100dvh-32px))] overflow-y-auto"
        onEscapeKeyDown={(event) => {
          // Escape closes the menu, not the surrounding editor dialog.
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          const target = pendingStep;
          pendingStep = undefined;
          if (!target || disposed || props.disabled) return;
          event.preventDefault();
          // Release the menu's focus trap before navigation focuses the editor.
          queueMicrotask(() => {
            if (!disposed && !props.disabled) props.onStep(target);
          });
        }}
      >
        <Dropdown.Group>
          <For each={EVENT_EDITOR_STEPS}>
            {(step, index) => (
              <Dropdown.Item
                aria-label={`Step ${index() + 1}: ${step.heading}`}
                aria-current={index() === props.step ? 'step' : undefined}
                disabled={props.disabled}
                onSelect={() => {
                  pendingStep = index() === props.step ? undefined : step.id;
                }}
              >
                <span
                  aria-hidden="true"
                  class="w-5 shrink-0 text-ink-muted tabular-nums"
                >
                  {index() + 1}
                </span>
                <span class="grow">{step.heading}</span>
                <Show when={index() === props.step}>
                  <Check class="size-4 shrink-0" aria-hidden="true" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

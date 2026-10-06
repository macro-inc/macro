import { InputGroup } from '@ui';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';

/** A numeric control with a pointer-captured scrub handle and a single commit per drag. */
export function InspectorNumberField(props: {
  label: string;
  icon: JSX.Element;
  value: number | undefined;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number | 'any';
  unit?: string;
  onChange: (value: number) => void;
  onScrub?: () => InspectorNumberScrub;
}) {
  const [draft, setDraft] = createSignal<number>();
  let drag:
    | {
        x: number;
        value: number;
        original: number | undefined;
        pointer: number;
        target: HTMLButtonElement;
        scrub: InspectorNumberScrub | undefined;
      }
    | undefined;
  const increment = () => (typeof props.step === 'number' ? props.step : 1);
  const normalize = (value: number) => {
    const step = increment();
    return Math.min(
      props.max ?? Infinity,
      Math.max(
        props.min ?? 0,
        props.step === 'any' ? value : Math.round(value / step) * step
      )
    );
  };
  const initialValue = () =>
    props.value ?? (Number.isFinite(props.min) ? props.min! : 0);
  const finish = (commit = false) => {
    const current = drag;
    const value = draft();
    drag = undefined;
    setDraft(undefined);
    window.removeEventListener('blur', cancel);
    if (!current) return;
    if (current.target.hasPointerCapture(current.pointer))
      current.target.releasePointerCapture(current.pointer);
    if (commit && value !== undefined && value !== current.original) {
      if (current.scrub) current.scrub.commit(value);
      else props.onChange(value);
    } else current.scrub?.cancel();
  };
  const cancel = () => finish();
  onCleanup(cancel);
  const update = (event: PointerEvent) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    if (event.clientX === drag.x && draft() === undefined) return;
    const value = normalize(
      drag.value +
        (event.clientX - drag.x) * increment() * (event.shiftKey ? 10 : 1)
    );
    if (value === draft()) return;
    setDraft(value);
    drag.scrub?.preview(value);
  };
  return (
    <InputGroup
      size="sm"
      class="border-transparent bg-hover/50 hover:border-edge-muted has-[button:focus]:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] has-[button:focus]:ring-2 has-[button:focus]:ring-edge-muted"
    >
      <InputGroup.Addon class="ps-0">
        <button
          type="button"
          disabled={props.disabled}
          aria-label={`Adjust ${props.label}`}
          title={`Drag to adjust ${props.label.toLowerCase()}. Shift for larger steps.`}
          class="flex h-full w-6 shrink-0 touch-none select-none items-center justify-center rounded-l-md text-ink-muted outline-none cursor-ew-resize"
          onPointerDown={(event) => {
            if (event.button !== 0 || drag) return;
            event.preventDefault();
            event.currentTarget.focus();
            drag = {
              x: event.clientX,
              value: initialValue(),
              original: props.value,
              pointer: event.pointerId,
              target: event.currentTarget,
              scrub: props.onScrub?.(),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
            window.addEventListener('blur', cancel);
          }}
          onPointerMove={update}
          onPointerUp={(event) => {
            if (!drag || drag.pointer !== event.pointerId) return;
            update(event);
            finish(true);
          }}
          onPointerCancel={(event) => {
            if (drag?.pointer === event.pointerId) cancel();
          }}
          onLostPointerCapture={(event) => {
            if (drag?.pointer === event.pointerId) cancel();
          }}
          onBlur={cancel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
            if (
              !['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(
                event.key
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
            const direction =
              event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
            props.onChange(
              normalize(
                initialValue() +
                  direction * increment() * (event.shiftKey ? 10 : 1)
              )
            );
          }}
        >
          {props.icon}
        </button>
      </InputGroup.Addon>
      <InputGroup.Input
        onClick={(event) => event.currentTarget.select()}
        disabled={props.disabled}
        type="text"
        inputMode="decimal"
        aria-label={props.label}
        min={props.min === -Infinity ? undefined : (props.min ?? 0)}
        max={props.max}
        step={props.step ?? 1}
        placeholder={
          props.disabled
            ? '—'
            : props.value === undefined
              ? 'Mixed'
              : String(props.value)
        }
        value={draft() ?? props.value ?? ''}
        class="px-1 text-xs tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={(event) => {
          const raw = event.currentTarget.value.trim();
          const value = raw === '' ? NaN : Number(raw);
          if (Number.isFinite(value)) props.onChange(normalize(value));
          event.currentTarget.value = String(props.value ?? '');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            const raw = event.currentTarget.value.trim();
            const value = raw === '' ? initialValue() : Number(raw);
            if (Number.isFinite(value)) {
              props.onChange(
                normalize(
                  value +
                    (event.key === 'ArrowUp' ? 1 : -1) *
                      increment() *
                      (event.shiftKey ? 10 : 1)
                )
              );
              event.currentTarget.value = String(props.value ?? '');
              event.currentTarget.select();
            }
          }
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <InputGroup.Addon align="inline-end" class="text-[10px]">
        {props.unit}
      </InputGroup.Addon>
    </InputGroup>
  );
}

import { t } from '@app/lib/i18n';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import type { PacketField } from '../core/packet';
import { FieldKindIcon, fieldKindLabel } from './field-kind';
import { type Tone, toneVars } from './tone';

/**
 * A field on the placement canvas, painted in its recipient's hue. The box
 * itself is the drag handle; a selected box also shows a resize corner.
 */
export function PlacedField(props: {
  field: PacketField;
  tone: Tone;
  recipientName: string;
  selected: boolean;
  onPointerDown: JSX.EventHandler<HTMLButtonElement, PointerEvent>;
  onResizePointerDown: JSX.EventHandler<HTMLSpanElement, PointerEvent>;
  onKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;
  onFocus: () => void;
  /** Controls shown above the selected field. */
  children?: JSX.Element;
}) {
  return (
    <div
      class="absolute"
      style={{
        ...toneVars(props.tone),
        left: `${props.field.box.xPct * 100}%`,
        top: `${props.field.box.yPct * 100}%`,
        width: `${props.field.box.widthPct * 100}%`,
        height: `${props.field.box.heightPct * 100}%`,
      }}
    >
      <button
        type="button"
        aria-pressed={props.selected}
        aria-label={t('contracts.placedFieldLabel', {
          field: fieldKindLabel(props.field.kind),
          name: props.recipientName,
        })}
        class="flex size-full touch-none items-center gap-[0.6cqw] overflow-hidden rounded-[0.6cqw] border-[1.5px] border-(--tone) bg-(--tone-bg) px-[0.9cqw] text-[1.8cqw] font-semibold text-(--tone-print) outline-none"
        classList={{
          'ring-[3px] ring-(--tone)/30': props.selected,
        }}
        onPointerDown={props.onPointerDown}
        onKeyDown={props.onKeyDown}
        onFocus={() => props.onFocus()}
      >
        <Show when={props.field.kind !== 'checkbox'}>
          <FieldKindIcon
            kind={props.field.kind}
            class="size-[2.2cqw] shrink-0"
          />
          <span class="truncate">{fieldKindLabel(props.field.kind)}</span>
        </Show>
      </button>
      <Show when={props.selected}>
        <span
          aria-hidden="true"
          class="absolute -right-1 -bottom-1 size-2.5 cursor-nwse-resize touch-none border-[1.5px] border-(--tone) bg-[#ffffff]"
          onPointerDown={props.onResizePointerDown}
        />
        {props.children}
      </Show>
    </div>
  );
}

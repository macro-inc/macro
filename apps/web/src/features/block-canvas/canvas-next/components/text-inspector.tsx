import type { TextGeometry } from '@macro-inc/graphics';
import Text from '@phosphor/text-t.svg';
import { Show } from 'solid-js';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';
import { InspectorNumberField } from './inspector-number-field';
import { InspectorSection } from './inspector-section';
import { InspectorSelect } from './inspector-select';
export function TextInspector(props: {
  label?: boolean;
  onScrub: () => InspectorNumberScrub;
  geometry: Pick<TextGeometry, 'fontSize' | 'fontFamily'> &
    Partial<Pick<TextGeometry, 'autoWidth'>>;
  onChange: (
    patch: Partial<Pick<TextGeometry, 'fontSize' | 'fontFamily' | 'autoWidth'>>
  ) => void;
}) {
  return (
    <InspectorSection title={props.label ? 'Shape label' : 'Typography'}>
      <div class="grid grid-cols-[4rem_1fr] items-center gap-3">
        <span class="text-xs text-ink-muted">Font</span>
        <InspectorSelect
          label="Font family"
          value={props.geometry.fontFamily}
          options={[
            { value: 'sans', label: 'Sans' },
            { value: 'serif', label: 'Serif' },
            { value: 'mono', label: 'Mono' },
          ]}
          onChange={(fontFamily) => props.onChange({ fontFamily })}
        />
      </div>
      <div class="grid grid-cols-2 items-center gap-3">
        <span class="text-xs text-ink-muted">Size</span>
        <InspectorNumberField
          label="Font size"
          icon={<Text class="size-4" />}
          value={Math.round(props.geometry.fontSize * 10) / 10}
          min={4}
          max={512}
          unit="px"
          onChange={(fontSize) => props.onChange({ fontSize })}
          onScrub={props.onScrub}
        />
      </div>
      <Show when={!props.label}>
        <button
          type="button"
          aria-pressed={props.geometry.autoWidth}
          class="w-full rounded border border-edge-muted px-2 py-1.5 text-xs hover:bg-hover"
          onClick={() =>
            props.onChange({ autoWidth: !props.geometry.autoWidth })
          }
        >
          {props.geometry.autoWidth ? 'Auto width' : 'Wrap to width'}
        </button>
      </Show>
      <p class="text-[10px] leading-relaxed text-ink-muted">
        {props.label
          ? 'Double-click or Enter to edit. Labels wrap and fit inside the shape.'
          : 'Double-click or Enter to edit. Side edges wrap; corners scale text.'}
      </p>
    </InspectorSection>
  );
}

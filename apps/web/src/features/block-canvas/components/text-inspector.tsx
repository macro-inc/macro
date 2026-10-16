import type { TextGeometry } from '@macro-inc/graphics';
import Text from '@phosphor/text-t.svg';
import { Show } from 'solid-js';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';
import { InspectorField } from './inspector-field';
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
    <InspectorSection title="Typography">
      <div class="grid grid-cols-2 gap-2">
        <InspectorField label="Font">
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
        </InspectorField>
        <InspectorField label="Size">
          <InspectorNumberField
            label="Font size"
            icon={<Text class="size-3" />}
            value={Math.round(props.geometry.fontSize * 10) / 10}
            min={4}
            max={512}
            unit="px"
            onChange={(fontSize) => props.onChange({ fontSize })}
            onScrub={props.onScrub}
          />
        </InspectorField>
      </div>
      <Show when={!props.label}>
        <button
          type="button"
          aria-pressed={props.geometry.autoWidth}
          class="h-6 w-full rounded-md bg-hover/50 px-2 text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-muted"
          onClick={() =>
            props.onChange({ autoWidth: !props.geometry.autoWidth })
          }
        >
          {props.geometry.autoWidth ? 'Auto width' : 'Wrap to width'}
        </button>
      </Show>
    </InspectorSection>
  );
}

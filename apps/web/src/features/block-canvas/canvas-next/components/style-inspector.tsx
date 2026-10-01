import type { Appearance } from '@macro-inc/graphics';
import Corners from '@phosphor/corners-out.svg';
import Drop from '@phosphor/drop.svg';
import Line from '@phosphor/line-segment.svg';
import { Show } from 'solid-js';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';
import { InspectorColorField } from './inspector-color-field';
import { InspectorNumberField } from './inspector-number-field';
import { InspectorSection } from './inspector-section';
import { InspectorSelect } from './inspector-select';

export function StyleInspector(props: {
  canvasColors: readonly string[];
  fill: boolean;
  stroke: boolean;
  strokePattern: boolean;
  corners: boolean;
  text: boolean;
  value: <K extends keyof Appearance>(key: K) => Appearance[K] | undefined;
  onChange: (patch: Partial<Appearance>) => void;
  onScrub: (
    key: 'opacity' | 'strokeWidth' | 'cornerRadius'
  ) => InspectorNumberScrub;
}) {
  return (
    <>
      <InspectorSection title="Appearance">
        <div class="grid grid-cols-2 items-center gap-3">
          <span class="text-xs text-ink-muted">Opacity</span>
          <InspectorNumberField
            label="Opacity (%)"
            icon={<Drop class="size-4" />}
            value={
              props.value('opacity') === undefined
                ? undefined
                : Math.round(props.value('opacity')! * 100)
            }
            max={100}
            unit="%"
            onChange={(value) => props.onChange({ opacity: value / 100 })}
            onScrub={() => props.onScrub('opacity')}
          />
        </div>
      </InspectorSection>
      <Show when={props.fill}>
        <InspectorSection title="Fill">
          <InspectorColorField
            label="Fill"
            canvasColors={props.canvasColors}
            value={props.value('fill')}
            onChange={(fill) => props.onChange({ fill })}
          />
        </InspectorSection>
      </Show>
      <Show when={props.stroke || props.text}>
        <InspectorSection title={props.text ? 'Text color' : 'Stroke'}>
          <InspectorColorField
            label={props.text ? 'Text' : 'Stroke'}
            canvasColors={props.canvasColors}
            value={props.value('stroke')}
            onChange={(stroke) => props.onChange({ stroke })}
          />
          <Show when={props.strokePattern}>
            <div class="grid grid-cols-2 items-center gap-3">
              <span class="text-xs text-ink-muted">Style</span>
              <InspectorSelect
                label="Stroke style"
                value={props.value('strokeStyle')}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' },
                ]}
                onChange={(strokeStyle) => props.onChange({ strokeStyle })}
              />
            </div>
          </Show>
          <Show when={props.stroke}>
            <div class="grid grid-cols-2 items-center gap-3">
              <span class="text-xs text-ink-muted">Weight</span>
              <InspectorNumberField
                label="Stroke width"
                icon={<Line class="size-4" />}
                value={props.value('strokeWidth')}
                max={40}
                step={0.5}
                unit="px"
                onChange={(strokeWidth) => props.onChange({ strokeWidth })}
                onScrub={() => props.onScrub('strokeWidth')}
              />
            </div>
          </Show>
        </InspectorSection>
      </Show>
      <Show when={props.corners}>
        <InspectorSection title="Corners">
          <div class="grid grid-cols-2 items-center gap-3">
            <span class="text-xs text-ink-muted">Radius</span>
            <InspectorNumberField
              label="Corner radius"
              icon={<Corners class="size-4" />}
              value={props.value('cornerRadius')}
              max={500}
              unit="px"
              onChange={(cornerRadius) => props.onChange({ cornerRadius })}
              onScrub={() => props.onScrub('cornerRadius')}
            />
          </div>
        </InspectorSection>
      </Show>
    </>
  );
}

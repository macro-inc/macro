import type { Appearance } from '@macro-inc/graphics';
import Corners from '@phosphor/corners-out.svg';
import Drop from '@phosphor/drop.svg';
import Line from '@phosphor/line-segment.svg';
import { Show } from 'solid-js';
import type { InspectorNumberScrub } from '../primitives/create-inspector-preview';
import { StrokeStyleIcon } from './connector-style-icon';
import { InspectorColorField } from './inspector-color-field';
import { InspectorField } from './inspector-field';
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
        <div class="grid grid-cols-2 gap-2">
          <InspectorField label="Opacity">
            <InspectorNumberField
              label="Opacity (%)"
              icon={<Drop class="size-3" />}
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
          </InspectorField>
          <Show when={props.corners}>
            <InspectorField label="Corner radius">
              <InspectorNumberField
                label="Corner radius"
                icon={<Corners class="size-3" />}
                value={props.value('cornerRadius')}
                max={500}
                onChange={(cornerRadius) => props.onChange({ cornerRadius })}
                onScrub={() => props.onScrub('cornerRadius')}
              />
            </InspectorField>
          </Show>
        </div>
      </InspectorSection>
      <Show when={props.fill || props.text}>
        <InspectorSection title="Fill">
          <InspectorColorField
            label={props.text ? 'Text' : 'Fill'}
            canvasColors={props.canvasColors}
            value={props.value(props.text ? 'stroke' : 'fill')}
            onChange={(color) =>
              props.onChange(props.text ? { stroke: color } : { fill: color })
            }
          />
        </InspectorSection>
      </Show>
      <Show when={props.stroke}>
        <InspectorSection title="Stroke">
          <InspectorColorField
            label="Stroke"
            canvasColors={props.canvasColors}
            value={props.value('stroke')}
            onChange={(stroke) => props.onChange({ stroke })}
          />
          <div class="grid grid-cols-2 gap-2">
            <InspectorField label="Weight">
              <InspectorNumberField
                label="Stroke width"
                icon={<Line class="size-3" />}
                value={props.value('strokeWidth')}
                max={40}
                step={0.5}
                onChange={(strokeWidth) => props.onChange({ strokeWidth })}
                onScrub={() => props.onScrub('strokeWidth')}
              />
            </InspectorField>
            <Show when={props.strokePattern}>
              <InspectorField label="Style">
                <InspectorSelect
                  label="Stroke style"
                  value={props.value('strokeStyle')}
                  renderIcon={(style) => <StrokeStyleIcon style={style} />}
                  options={[
                    { value: 'solid', label: 'Solid' },
                    { value: 'dashed', label: 'Dashed' },
                    { value: 'dotted', label: 'Dotted' },
                  ]}
                  onChange={(strokeStyle) => props.onChange({ strokeStyle })}
                />
              </InspectorField>
            </Show>
          </div>
        </InspectorSection>
      </Show>
    </>
  );
}

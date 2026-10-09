import type { ConnectorStyle } from '@macro-inc/graphics';
import { For } from 'solid-js';
import {
  ConnectorEndpointIcon,
  ConnectorRouteIcon,
} from './connector-style-icon';
import { InspectorField } from './inspector-field';
import { InspectorSection } from './inspector-section';
import { InspectorSelect } from './inspector-select';

export function ConnectorInspector(props: {
  value: Partial<ConnectorStyle>;
  onChange: (patch: Partial<ConnectorStyle>) => void;
}) {
  return (
    <InspectorSection title="Connection">
      <InspectorField label="Route">
        <InspectorSelect
          label="Connector route"
          value={props.value.route}
          renderIcon={(route) => <ConnectorRouteIcon route={route} />}
          options={[
            { value: 'straight', label: 'Straight' },
            { value: 'stepped', label: 'Elbow' },
            { value: 'smooth', label: 'Smooth' },
          ]}
          onChange={(route) => props.onChange({ route })}
        />
      </InspectorField>
      <div class="grid grid-cols-2 gap-2">
        <For each={['startHead', 'endHead'] as const}>
          {(key) => (
            <InspectorField label={key === 'startHead' ? 'Start' : 'End'}>
              <InspectorSelect
                label={
                  key === 'startHead'
                    ? 'Connector start style'
                    : 'Connector end style'
                }
                value={props.value[key]}
                renderIcon={(head) => (
                  <ConnectorEndpointIcon
                    head={head}
                    start={key === 'startHead'}
                  />
                )}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'arrow', label: 'Arrow' },
                  { value: 'arrow-filled', label: 'Filled arrow' },
                  { value: 'circle', label: 'Dot' },
                  { value: 'circle-small', label: 'Small dot' },
                ]}
                onChange={(value) => props.onChange({ [key]: value })}
              />
            </InspectorField>
          )}
        </For>
      </div>
    </InspectorSection>
  );
}

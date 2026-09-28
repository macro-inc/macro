import type { ConnectorStyle } from '@macro-inc/graphics';
import { For } from 'solid-js';

export function ConnectorInspector(props: {
  value: ConnectorStyle;
  onChange: (patch: Partial<ConnectorStyle>) => void;
}) {
  return (
    <section
      class="space-y-3 border-b border-edge-muted p-3"
      aria-label="Connector style"
    >
      <h2 class="text-xs font-medium">Connector</h2>
      <label class="flex items-center justify-between text-xs">
        Route
        <select
          aria-label="Connector route"
          class="rounded border border-edge-muted bg-panel px-2 py-1"
          value={props.value.route}
          onChange={(event) =>
            props.onChange({
              route: event.currentTarget.value as ConnectorStyle['route'],
            })
          }
        >
          <option value="straight">Straight</option>
          <option value="stepped">Elbow</option>
          <option value="smooth">Smooth</option>
        </select>
      </label>
      <For each={['startHead', 'endHead'] as const}>
        {(key) => (
          <label class="flex items-center justify-between text-xs">
            {key === 'startHead' ? 'Start' : 'End'}
            <select
              aria-label={
                key === 'startHead'
                  ? 'Connector start style'
                  : 'Connector end style'
              }
              class="rounded border border-edge-muted bg-panel px-2 py-1"
              value={props.value[key]}
              onChange={(event) =>
                props.onChange({
                  [key]: event.currentTarget
                    .value as ConnectorStyle[typeof key],
                })
              }
            >
              <option value="none">None</option>
              <option value="arrow">Arrow</option>
              <option value="arrow-filled">Filled arrow</option>
              <option value="circle">Dot</option>
              <option value="circle-small">Small dot</option>
            </select>
          </label>
        )}
      </For>
    </section>
  );
}

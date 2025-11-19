import type { Accessor, Component } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import type { Property } from '../../types';
import { PropertyGrid } from './PropertyGrid';

interface PropertiesContentProps {
  properties: Accessor<Property[]>;
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  emptyMessage?: string;
}

export const PanelContainer: Component<PropertiesContentProps> = (props) => {
  const hasProperties = createMemo(() => props.properties().length > 0);
  const showContent = createMemo(
    () => hasProperties() || (!props.isLoading() && !props.error())
  );

  return (
    <Show when={showContent()}>
      <Show when={!hasProperties()}>
        <div class="text-center py-8 text-ink-muted">
          <p>{props.emptyMessage ?? 'No properties added yet'}</p>
        </div>
      </Show>

      <Show when={hasProperties()}>
        <div class="flex-1 overflow-y-auto overflow-x-auto px-2 pb-2">
          <PropertyGrid properties={props.properties()} />
        </div>
      </Show>
    </Show>
  );
};

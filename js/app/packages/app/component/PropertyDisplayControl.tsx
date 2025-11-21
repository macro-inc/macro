import type { Accessor, Component } from 'solid-js';
import type { DisplayOptions } from './ViewConfig';

type PropertyDisplayControlProps = {
  selectedPropertyIds: Accessor<DisplayOptions['displayProperties']>;
  setSelectedPropertyIds: (
    properties: DisplayOptions['displayProperties']
  ) => void;
};

export const PropertyDisplayControl: Component<PropertyDisplayControlProps> = (
  _props
) => {
  return (
    <div>
      <div class="font-medium text-xs mb-2">Properties</div>
      {/* Component will be built out in next chunks */}
    </div>
  );
};

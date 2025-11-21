import type { PropertyDefinitionFlat } from '@core/component/Properties/types';
import { ERROR_MESSAGES } from '@core/component/Properties/utils/errorHandling';
import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import type { Accessor, Component } from 'solid-js';
import { createSignal, onMount } from 'solid-js';
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
  const [_availableProperties, setAvailableProperties] = createSignal<
    PropertyDefinitionFlat[]
  >([]);
  const [_isLoading, setIsLoading] = createSignal(false);
  const [_error, setError] = createSignal<string | null>(null);

  const fetchAvailableProperties = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await propertiesServiceClient.listProperties({
        scope: 'all',
        include_options: false,
      });

      if (isErr(result)) {
        setError(ERROR_MESSAGES.PROPERTY_FETCH);
        setIsLoading(false);
        return;
      }

      const [, data] = result;
      const properties = Array.isArray(data) ? data : [];

      setAvailableProperties(properties);
      setIsLoading(false);
    } catch (_apiError) {
      setError(ERROR_MESSAGES.PROPERTY_FETCH);
      setIsLoading(false);
    }
  };

  onMount(() => {
    fetchAvailableProperties();
  });

  return (
    <div>
      <div class="font-medium text-xs mb-2">Properties</div>
      {/* Component will be built out in next chunks */}
      {/* Available properties: {availableProperties().length} */}
      {/* Loading: {isLoading() ? 'Yes' : 'No'} */}
      {/* Error: {error() ?? 'None'} */}
    </div>
  );
};

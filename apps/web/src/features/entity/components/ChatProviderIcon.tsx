import {
  modelProvider,
  ProviderIcon,
} from '@core/component/AI/component/ProviderIcon';
import { getChatStoredModel } from '@core/component/AI/util/storage';
import { EntityIcon, type EntityIconProps } from '@core/component/EntityIcon';
import { Show } from 'solid-js';

/** Soup supplies the saved model; a local draft selection takes precedence. */
export function ChatProviderIcon(props: {
  id: string;
  model?: string | null;
  class?: string;
  animate?: boolean;
  weight?: EntityIconProps['weight'];
}) {
  const model = () => {
    const stored = getChatStoredModel(props.id);
    // Historical models still identify their provider even after they leave the
    // picker. Applying the composer's default here would mislabel them as Claude.
    return modelProvider(stored) ? stored : props.model;
  };
  return (
    <Show
      when={modelProvider(model())}
      fallback={
        <EntityIcon
          targetType="chat"
          size="fill"
          class={props.class}
          weight={props.weight}
        />
      }
    >
      <ProviderIcon
        model={model()}
        class={props.class}
        animate={props.animate}
      />
    </Show>
  );
}

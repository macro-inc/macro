import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { resolveChatInputModel } from '@core/component/AI/util/parse';
import { getChatInputStoredModel } from '@core/component/AI/util/storage';
import { EntityIcon } from '@core/component/EntityIcon';
import { Show } from 'solid-js';

/** Soup supplies the saved model; a local draft selection takes precedence. */
export function ChatProviderIcon(props: {
  id: string;
  model?: string | null;
  class?: string;
  animate?: boolean;
}) {
  const model = () =>
    getChatInputStoredModel(props.id) ??
    (props.model != null ? resolveChatInputModel(props.model) : undefined);
  return (
    <Show
      when={model()}
      fallback={
        <EntityIcon targetType="chat" size="fill" class={props.class} />
      }
    >
      {(model) => (
        <ProviderIcon
          model={model()}
          class={props.class}
          animate={props.animate}
        />
      )}
    </Show>
  );
}

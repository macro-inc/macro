import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { resolveChatInputModel } from '@core/component/AI/util/parse';
import { getChatInputStoredModel } from '@core/component/AI/util/storage';
import { useChatDataQuery } from '@queries/cognition/chat-data';

/** Soup omits the model. Reuse the chat cache, fetching only mounted chat rows. */
export function ChatProviderIcon(props: {
  id: string;
  class?: string;
  animate?: boolean;
}) {
  const chat = useChatDataQuery(() => props.id);
  // An icon must never suspend the list or replace it with a query error screen.
  const model = () =>
    getChatInputStoredModel(props.id) ??
    (chat.isSuccess ? resolveChatInputModel(chat.data?.model) : undefined);
  return (
    <ProviderIcon model={model()} class={props.class} animate={props.animate} />
  );
}

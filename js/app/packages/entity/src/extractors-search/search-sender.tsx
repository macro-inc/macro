import { Show } from 'solid-js';
import type {
  ContentHitData,
  ChannelContentHitData,
  EmailContentHitData,
} from '../types/search';
import { DisplayName } from '../components/DisplayName';

interface SearchSenderProps {
  hit?: ContentHitData;
}

/**
 * Gets sender ID from content hit if available
 */
function getSenderId(hit: ContentHitData): string | undefined {
  if (hit.type === 'channel') {
    return (hit as ChannelContentHitData).senderId;
  }
  if (hit.type === 'email') {
    return (hit as EmailContentHitData).senderId;
  }
  return undefined;
}

/**
 * Displays the sender of a search hit (for channel/email)
 */
export function SearchSender(props: SearchSenderProps) {
  const senderId = () => (props.hit ? getSenderId(props.hit) : undefined);

  return (
    <Show when={senderId()}>
      {(id) => <DisplayName id={id()} format="firstName" />}
    </Show>
  );
}

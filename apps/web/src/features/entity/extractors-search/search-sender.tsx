import { Show } from 'solid-js';
import { DisplayName } from '../components/DisplayName';
import type { ContentHitData } from '../types/search';
import { getSenderId } from './search-helpers';

interface SearchSenderProps {
  hit?: ContentHitData;
}

/**
 * Displays the sender of a search hit (for channel/email/call_record)
 */
export function SearchSender(props: SearchSenderProps) {
  const senderId = () => (props.hit ? getSenderId(props.hit) : undefined);

  return (
    <Show when={senderId()}>
      {(id) => <DisplayName id={id()} format="firstName" />}
    </Show>
  );
}

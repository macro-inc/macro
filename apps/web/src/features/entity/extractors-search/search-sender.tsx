import { isMacroId } from '@core/user/macroId';
import { Show } from 'solid-js';
import { DisplayName } from '../components/DisplayName';
import type { ContentHitData } from '../types/search';
import { getSenderId } from './search-helpers';

interface SearchSenderProps {
  hit?: ContentHitData;
}

/**
 * Displays the sender of a search hit (for channel/email/call_record).
 * Call guests have session-scoped uuids instead of Macro ids.
 */
export function SearchSender(props: SearchSenderProps) {
  const senderId = () => (props.hit ? getSenderId(props.hit) : undefined);

  return (
    <Show when={senderId()}>
      {(id) => (
        <Show when={isMacroId(id())} fallback="Guest">
          <DisplayName id={id()} format="firstName" />
        </Show>
      )}
    </Show>
  );
}

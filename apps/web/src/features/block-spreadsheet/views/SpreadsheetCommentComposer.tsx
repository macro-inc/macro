import {
  ChannelInput,
  type InputHandle,
  type InputSnapshot,
} from '@channel/Input';
import type { MessageParent } from '@service-storage/messages';

export function SpreadsheetCommentComposer(props: {
  parent: MessageParent;
  onSend: (snapshot: InputSnapshot) => Promise<void>;
  autofocus?: boolean;
}) {
  let input: InputHandle | undefined;
  return (
    <ChannelInput
      parent={props.parent}
      flat
      autofocus={props.autofocus ?? false}
      input={{ mode: 'reply', placeholder: 'Leave a comment...' }}
      onReady={(handle) => (input = handle)}
      onSend={async (snapshot) => {
        await props.onSend(snapshot);
        input?.clear();
      }}
    />
  );
}

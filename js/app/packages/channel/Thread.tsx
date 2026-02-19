import type { ApiChannelMessage } from '@service-comms/client';
import type { Accessor, Setter } from 'solid-js';
import { Message } from './Message';

export type ThreadProps = {
  data: Accessor<ApiChannelMessage>;
  isExpanded: Accessor<boolean>;
  setIsExpanded: Setter<boolean>;
};

const DEFAULT_REPLY_COUNT = 3;

export function Thread(props: ThreadProps) {
  return (
    <div>
      <Message message={props.data()} />
      <div class="flex flex-col"></div>
    </div>
  );
}

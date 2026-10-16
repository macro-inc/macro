import type { Accessor } from 'solid-js';
import type {
  MessageOperation,
  MessageResolutionAction,
} from '../core/message-operation';

export interface MessageOperationSource {
  needsReload?: Accessor<boolean>;
  operation: Accessor<MessageOperation | null | undefined>;
  resolve(
    operation: MessageOperation,
    action: MessageResolutionAction,
    acceptDuplicateRisk: boolean
  ): Promise<void>;
}
export type MessageOperationSourceFactory = (
  messageId: Accessor<string | undefined>,
  threadId?: Accessor<string | undefined>
) => MessageOperationSource;

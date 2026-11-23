/**
 * Chat's half of a `SendEmail` draft. Legacy chats are read-only, so the
 * draft renders without any way to edit, send or reject it.
 */

import type { SendEmail } from '@service-cognition/generated/tools/types';
import type { JSX } from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import { EmailDraftComposer } from './DraftComposer';

const readOnlySink: UserToolReviewSink<SendEmail> = {
  canAct: () => false,
  lockedNotice: () => undefined,
  onExecute: async () => false,
  onReject: async () => false,
};

export function ComposeTool(props: {
  chatId: string;
  messageId: string;
  toolCallId: string;
  initialData: SendEmail;
  header?: JSX.Element;
}) {
  return (
    <EmailDraftComposer
      initialData={props.initialData}
      sink={readOnlySink}
      header={props.header}
      readOnly
      debugName={`${props.chatId}:${props.messageId}:${props.toolCallId}`}
    />
  );
}

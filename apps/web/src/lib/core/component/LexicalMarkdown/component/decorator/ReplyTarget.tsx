import { projectRouteId } from '@app/features/projects/core/route';
import {
  callDetailSearch,
  callDetailSearchCodec,
} from '@block-call/call-route';
import { URL_PARAMS as CALL_PARAMS } from '@block-call/constants';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { MessageReferenceNavigation } from '@core/messages/message-reference-navigation';
import { getDisplayName, tryMacroId } from '@core/user';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import type { ReplyTargetDecoratorProps } from '@macro-inc/lexical-core';
import { useBotsQuery } from '@queries/bots/bots';
import { useChannelBotsQuery } from '@queries/channel/channel-bots';
import { getBotDisplayName } from '@queries/messages/message-sender';
import { useDocumentMetadataQuery } from '@queries/storage/document-metadata';
import { createCallback } from '@solid-primitives/rootless';
import { useContext } from 'solid-js';
import { match } from 'ts-pattern';
import { openDocument } from '../core/BlockLink';
import { QuoteReplyPreview } from './QuoteReplyPreview';

/** Single-line message reply reference rendered by a ReplyTargetNode. */
export function ReplyTarget(props: ReplyTargetDecoratorProps) {
  const navigateReference = useContext(MessageReferenceNavigation);
  const currentBlockId = useMaybeBlockId();
  const currentBlockName = useMaybeBlockName();
  const channelBots = useChannelBotsQuery(() =>
    props.parent.type === 'channel' ? props.parent.id : ''
  );
  const bots = useBotsQuery();
  const document = useDocumentMetadataQuery(() =>
    props.parent.type === 'document' ? props.parent.id : ''
  );
  const senderName = () =>
    getBotDisplayName(
      props.senderId,
      undefined,
      props.parent.type === 'channel'
        ? channelBots.isSuccess
          ? channelBots.data
          : []
        : bots.isSuccess
          ? bots.data
          : []
    ) ||
    getDisplayName(tryMacroId(props.senderId), {}) ||
    props.senderId;

  const target = ():
    | {
        type: string;
        id: string;
        params: Record<string, string>;
      }
    | undefined =>
    match(props.parent.type)
      .with('channel', () => ({
        type: 'channel',
        id: props.parent.id,
        params: {
          [CHANNEL_PARAMS.message]: props.targetMessageId,
          [CHANNEL_PARAMS.thread]: props.targetThreadId,
        },
      }))
      .with('call', () => ({
        type: 'call',
        id: props.parent.id,
        params: { [CALL_PARAMS.messageId]: props.targetMessageId },
      }))
      .with('initiative', () => ({
        type: 'component',
        id: projectRouteId({
          id: props.parent.id,
          section: 'overview',
          discussionId: props.targetMessageId,
        }),
        params: {},
      }))
      .with('crm_company', 'crm_contact', (type) => ({
        type,
        id: props.parent.id,
        params: { comment_id: props.targetMessageId },
      }))
      .with('document', () =>
        document.isSuccess && document.data.fileType
          ? {
              type: document.data.fileType,
              id: props.parent.id,
              params: { comment_id: props.targetMessageId },
            }
          : undefined
      )
      .exhaustive();

  const openTarget = createCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.shiftKey && navigateReference?.(props)) return;
    const destination = target();
    if (!destination) return;
    const preferNewSplit = openInNewSplitForMention(
      event.shiftKey,
      currentBlockName !== destination.type || currentBlockId !== destination.id
    );
    if (props.parent.type === 'call') {
      // Route search delivers a fresh request even when this call is already open.
      useSplitLayout().openWithSplit(
        { type: 'call', id: destination.id },
        {
          preferNewSplit,
          search: {
            [callDetailSearch.namespace]: callDetailSearchCodec.serialize({
              ...callDetailSearch.defaults,
              messageId: props.targetMessageId,
              seek: crypto.randomUUID(),
            }),
          },
        }
      );
      return;
    }
    openDocument(
      destination.type,
      destination.id,
      destination.params,
      preferNewSplit
    );
  });

  return (
    <QuoteReplyPreview
      label={senderName()}
      text={props.displayText}
      ariaLabel={`Replying to ${senderName()}: ${props.displayText}`}
      disabled={!target()}
      onClick={openTarget}
      buttonAttrs={{
        'data-reply-target-target-message-id': props.targetMessageId,
      }}
    />
  );
}

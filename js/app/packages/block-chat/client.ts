import type { BlockName } from '@core/block';
import { usePaywallState } from '@core/constant/PaywallState';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { propsToHref } from '@core/util/url';
import { postNewHistoryItem } from '@queries/history/history';
import { cognitionApiServiceClient } from '@service-cognition/client';

export function useOpenChatForAttachment() {
  const { showPaywall } = usePaywallState();

  return async function openChatForAttachment(args: {
    attachmentId: string;
    callerBlock?: {
      name: BlockName;
      id: string;
    };
  }) {
    const { attachmentId, callerBlock } = args;
    const res = await cognitionApiServiceClient.getChatsForAttachment({
      attachment_id: attachmentId,
    });
    if (isErr(res)) return;
    const [, data] = res;

    let recent_id = data?.recent_chat?.id;

    if (
      (!recent_id || !data?.recent_chat?.isPersistent) &&
      callerBlock?.name === 'image'
    ) {
      const res = await cognitionApiServiceClient.createChat({});

      if (isPaymentError(res)) {
        showPaywall();
        return;
      }
      if (isErr(res)) {
        return;
      }
      const [, data] = res;
      recent_id = data?.id;
    } else if (!recent_id || !data?.recent_chat?.isPersistent) {
      const res = await cognitionApiServiceClient.createChat({});

      if (isPaymentError(res)) {
        showPaywall();
        return;
      }
      if (isErr(res)) {
        return;
      }
      const [, data] = res;
      recent_id = data?.id;
    }
  };
}

export async function copyChat(args: { id: string; name: string }) {
  const { showPaywall } = usePaywallState();
  const result = await cognitionApiServiceClient.copyChat({
    chat_id: args.id,
    name: args.name,
  });
  if (isPaymentError(result)) {
    showPaywall();
    throw result[0];
  }
  if (isErr(result)) {
    throw result[0];
  }
  const [_, { id }] = result;
  postNewHistoryItem('chat', id);
  const href = propsToHref({
    id,
    fileType: 'chat',
  });
  return { id, href };
}

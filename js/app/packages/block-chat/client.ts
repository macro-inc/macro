import type { BlockName } from '@core/block';
import { usePaywallState } from '@core/constant/PaywallState';
import { isPaymentError } from '@core/util/handlePaymentError';

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
    if (res.isErr()) return;
    const data = res.value;

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
      if (res.isErr()) {
        return;
      }
      const data = res.value;
      recent_id = data?.id;
    } else if (!recent_id || !data?.recent_chat?.isPersistent) {
      const res = await cognitionApiServiceClient.createChat({});

      if (isPaymentError(res)) {
        showPaywall();
        return;
      }
      if (res.isErr()) {
        return;
      }
      const data = res.value;
      recent_id = data?.id;
    }
  };
}

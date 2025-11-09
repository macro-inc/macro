import type { Edit, Send } from '@core/component/AI/types';
import { cognitionWebsocketServiceClient } from '@service-cognition/client';

export function asEditRequest(request: Send): Edit {
  let call = () =>
    cognitionWebsocketServiceClient.streamEditMessage(request.request);

  return {
    ...request,
    call,
  };
}

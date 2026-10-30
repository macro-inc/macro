import { callServiceClient } from '@service-call/client';

export const fetchCallRecord: typeof callServiceClient.getCallRecord = (
  ...args
) => callServiceClient.getCallRecord(...args);

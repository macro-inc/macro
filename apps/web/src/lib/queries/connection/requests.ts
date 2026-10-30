import { connectionGatewayClient } from '@service-connection/client';

export const trackEntity: typeof connectionGatewayClient.trackEntity = (
  ...args
) => connectionGatewayClient.trackEntity(...args);

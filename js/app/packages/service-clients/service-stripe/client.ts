import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { registerClient } from '@core/util/mockClient';
import { getAccessToken } from '@service-auth/client';
import { LegacyApiRpcClient } from '../../codegen/auth_service/auth_service_rpc';

// Create a singleton instance of the RPC client
let rpcClientInstance: LegacyApiRpcClient | null = null;

async function getRpcClient(): Promise<LegacyApiRpcClient> {
  if (!rpcClientInstance) {
    const headers = new Headers();

    if (ENABLE_BEARER_TOKEN_AUTH) {
      const token = await getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    rpcClientInstance = LegacyApiRpcClient.construct_with_headers(
      `${SERVER_HOSTS['auth-service']}/user`,
      () => headers
    );
  }
  return rpcClientInstance;
}

export const stripeServiceClient = {
  /**
   * Creates a checkout session
   * @returns The URL of the checkout session
   */
  createCheckoutSession: async (type: string = '', discount?: string) => {
    const variables = {
      successUrl: `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app`,
      discount: discount ?? null,
    };

    const client = await getRpcClient();
    const data = await client.create_checkout_session(variables);

    return data.url;
  },
  /**
   * Creates a portal session
   * @returns
   */
  createPortalSession: async () => {
    const variables = {
      returnUrl: `${window.location.origin}/app`,
    };

    const client = await getRpcClient();
    const res = await client.create_portal_session(variables);

    return res.url;
  },
};

registerClient('stripe', stripeServiceClient);

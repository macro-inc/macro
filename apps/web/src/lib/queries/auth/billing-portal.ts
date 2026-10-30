import { stripeServiceClient } from '@service-stripe/client';

export const createBillingPortalSession: typeof stripeServiceClient.createPortalSession =
  (...args) => stripeServiceClient.createPortalSession(...args);

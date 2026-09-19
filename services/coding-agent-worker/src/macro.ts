import { Macro } from '@macro/sdk';
import { env } from './env';
import { ensureWebhook } from './webhook';

// Registration must happen before the client is built: the events receiver
// verifies delivery signatures with the returned secret.
const webhookSecret = await ensureWebhook(`${env.PUBLIC_URL}/macro-events`);

/** The one Macro SDK client, shared by everything in this worker. The SDK
 * resolves service hosts itself (MACRO_ENV, plus the local-stack portmap
 * when it's `local`). */
export const macro = new Macro({ webhookSecret }).requestedAs(
  env.MACRO_USER_ID
);

import { Macro } from '@macro/sdk';
import { env } from '../../src/env';

const macro = new Macro({}).requestedAs(env.MACRO_USER_ID);
const hooks = await macro.webhooks.list();
for (const h of hooks) {
  console.log({
    id: h.id,
    name: await h.name(),
    url: await h.endpointUrl(),
    status: await h.status(),
    createdAt: await h.createdAt(),
  });
}

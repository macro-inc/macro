import type { ComponentProps } from 'solid-js';
import { createEmailComposeContext } from './compose-adapter';
import { createEmailComposeHost } from './compose-host-adapter';
import { EmailComposeView } from './views/email-compose';
export function EmailCompose(
  props: Omit<ComponentProps<typeof EmailComposeView>, 'context' | 'host'>
) {
  const composeContext = createEmailComposeContext();
  const host = createEmailComposeHost();
  return <EmailComposeView {...props} context={composeContext} host={host} />;
}

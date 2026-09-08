import type { ComponentProps } from 'solid-js';
import { createEmailComposeEnvironment } from './compose-adapter';
import { createEmailComposeHost } from './compose-host-adapter';
import { EmailComposeView } from './views/email-compose';
export function EmailCompose(
  props: Omit<ComponentProps<typeof EmailComposeView>, 'services' | 'host'>
) {
  const services = createEmailComposeEnvironment();
  const host = createEmailComposeHost();
  return <EmailComposeView {...props} services={services} host={host} />;
}

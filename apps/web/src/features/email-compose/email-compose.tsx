import type { ComponentProps } from 'solid-js';
import { createEmailComposeHost } from './compose-host-adapter';
import { createEmailComposeServices } from './compose-service-adapter';
import { EmailComposeView } from './views/email-compose';
export function EmailCompose(
  props: Omit<ComponentProps<typeof EmailComposeView>, 'services' | 'host'>
) {
  const services = createEmailComposeServices();
  const host = createEmailComposeHost();
  return <EmailComposeView {...props} services={services} host={host} />;
}

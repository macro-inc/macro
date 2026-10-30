import type { ComponentProps } from 'solid-js';
import { createEmailComposeContext } from './compose-adapter';
import { createComposeRouteHost } from './compose-host-adapter';
import { createComposeRouteDraft } from './compose-route-draft';
import { EmailComposeView } from './views/email-compose';
export function EmailCompose(
  props: Omit<ComponentProps<typeof EmailComposeView>, 'context' | 'host'>
) {
  const composeContext = createEmailComposeContext();
  const route = createComposeRouteDraft();
  const host = createComposeRouteHost(route);
  // History keeps the params this route opened with; a moved draft lives on
  // only in the URL.
  const draftId = route.draftId() ?? props.draftId;
  return (
    <EmailComposeView
      {...props}
      draftId={draftId}
      context={composeContext}
      host={host}
    />
  );
}

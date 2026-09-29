import {
  createSearchParams,
  defineRoute,
  useParams,
} from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { uuidRouteReference } from '@components/app/split-layout/split-router/mention-links';
import { Show } from 'solid-js';
import { z } from 'zod';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '../email-thread/core/location';
import { EmailDetailRouteView } from './components/EmailDetailView';
import { emailDetailSearch } from './email-route';
import { EmailView } from './email-view';

function MailLegacyRouteView() {
  const params = useParams<{ threadId?: string }>();
  const [search] = createSearchParams(emailDetailSearch);
  const legacyThread = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[EMAIL_URL_PARAMS.messageId] = search.messageId;
    return { type: 'email', id, params };
  };

  return (
    <Show when={params.threadId}>
      {(threadId) => <RedirectSplit to={legacyThread(threadId())} />}
    </Show>
  );
}

export const MailRouteView = withAuth(() => {
  const params = useParams<{ threadId?: string }>();
  const detailRequested = () => typeof params.threadId === 'string';

  return (
    <AppView
      id="mail"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<MailLegacyRouteView />}
    >
      <EmailView />
    </AppView>
  );
});

export const emailThreadRoute = defineRoute({
  id: 'mail-thread',
  path: ':threadId',
  params: z.object({ threadId: z.string().min(1) }),
  component: EmailDetailRouteView,
  externalSearch: ['email_message_id'],
  remountKey: ({ threadId }) => threadId,
  claim: ({ threadId }) => ({
    namespace: 'block',
    id: `email:${threadId}`,
  }),
  toReference: ({ threadId }) => uuidRouteReference(threadId, 'email'),
});

export const emailSplitRoute = defineRoute({
  id: 'view-mail',
  path: 'mail',
  component: MailRouteView,
  search: '*' as const,
  children: [emailThreadRoute],
});

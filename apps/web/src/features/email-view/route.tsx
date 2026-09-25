import {
  createSearchParams,
  defineRoute,
  useParams,
} from '@app/lib/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  NewAppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, Show } from 'solid-js';
import { z } from 'zod';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '../email-thread/core/location';
import { getViewPreset } from '../next-soup/sidebar/soup-filter-presets';
import { emailDetailSearch } from './email-route';

const SoupView = lazy(async () => ({
  default: (await import('../next-soup/soup-view/soup-view')).SoupView,
}));
const EmailView = lazy(async () => ({
  default: (await import('./email-view')).EmailView,
}));
const EmailDetailRouteView = lazy(async () => ({
  default: (await import('./components/EmailDetailView')).EmailDetailRouteView,
}));

function LegacyMailView() {
  const preset = getViewPreset('mail');
  return (
    <SoupView
      viewName="Email"
      initialFilters={preset?.filters}
      initialClientFilters={preset?.clientFilters}
      initialGroupBy={preset?.groupBy}
    />
  );
}

function MailLegacyRouteView() {
  const params = useParams<{ threadId?: string }>();
  const [search] = createSearchParams(emailDetailSearch);
  const legacyThread = (id: string): SplitContent => {
    const params: Record<string, string> = {};
    if (search.messageId) params[EMAIL_URL_PARAMS.messageId] = search.messageId;
    return { type: 'email', id, params };
  };

  return (
    <Show when={params.threadId} fallback={<LegacyMailView />}>
      {(threadId) => <RedirectSplit to={legacyThread(threadId())} />}
    </Show>
  );
}

export const MailRouteView = withAuth(() => {
  const params = useParams<{ threadId?: string }>();
  const detailRequested = () => typeof params.threadId === 'string';

  return (
    <NewAppView
      id="mail"
      detailDesktopOnly
      detailRequested={detailRequested}
      detailFallback={<MailLegacyRouteView />}
      fallback={<LegacyMailView />}
    >
      <EmailView />
    </NewAppView>
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
});

export const emailSplitRoute = defineRoute({
  id: 'view-mail',
  path: 'mail',
  component: MailRouteView,
  search: '*' as const,
  children: [emailThreadRoute],
});

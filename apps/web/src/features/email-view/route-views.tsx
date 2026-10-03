import { createSearchParams, useParams } from '@app/split-router';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import {
  AppView,
  RedirectSplit,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { Show } from 'solid-js';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '../email-thread/core/location';
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

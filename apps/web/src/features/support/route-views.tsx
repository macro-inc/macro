import { createSearchParams } from '@app/lib/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { createMemo, lazy, Show } from 'solid-js';
import { supportSearch } from './navigation';

const Support = lazy(async () => ({
  default: (await import('./Support')).Support,
}));
export const SupportRouteView = withAuth(
  (props: {
    initialTicket?: string;
    companyId?: string;
    contactId?: string;
  }) => {
    usePageViewTracking('support');
    const [search] = createSearchParams(supportSearch);
    const target = createMemo(() => ({
      initialTicket: (props.initialTicket ?? search.ticket) || undefined,
      companyId: (props.companyId ?? search.companyId) || undefined,
      contactId: (props.contactId ?? search.contactId) || undefined,
    }));
    return (
      <Show when={target()} keyed>
        {(value) => <Support {...value} />}
      </Show>
    );
  }
);

import { Telemetry } from '@macro-inc/observability';
import type { ListLinksResponse } from '@service-email/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { QueryAccount } from '../auth/account-scope';
import { emailLinksQueryOptions } from '../email/link';
import { queryReadyGate } from '../gate';
import { buildContactContextFacts, type ContextChannel } from './context-facts';

// Selectors capture resolved ownership. Retained data from an old observer/key
// can never be relabeled with the current account during Solid reconciliation.
function linksOptions(account: QueryAccount | undefined, enabled: boolean) {
  return {
    ...emailLinksQueryOptions(account, enabled),
    select: (rows: ListLinksResponse) => ({ account, rows }),
  };
}
function sameAccount(a: QueryAccount | undefined, b: QueryAccount): boolean {
  return a?.userId === b.userId && a.session === b.session;
}

/** Contact facts from the viewer's channel directory and inboxes; no
 * contact-directory read. `channels` is undefined until the directory is
 * complete, and the inbox read is status-gated so background publishing
 * cannot suspend the app shell. */
export function createContactContextSource(options: {
  account: Accessor<QueryAccount | undefined>;
  channels: Accessor<readonly ContextChannel[] | undefined>;
  enabled: Accessor<boolean>;
}) {
  const links = useQuery(() =>
    linksOptions(options.account(), options.enabled())
  );
  return createMemo(() => {
    const account = options.account();
    const channels = options.channels();
    if (!options.enabled() || !account || !channels || !queryReadyGate(links))
      return;
    const l = links.data;
    if (!sameAccount(l.account, account)) return;
    const span = Telemetry.span('contacts.context.derive');
    span.setAttr('contacts.channel_count', channels.length);
    try {
      const facts = buildContactContextFacts({
        viewer: account.userId,
        channels,
        links: l.rows.links,
      });
      span.setAttr('contacts.context_count', facts.size);
      return facts;
    } finally {
      span.end();
    }
  });
}

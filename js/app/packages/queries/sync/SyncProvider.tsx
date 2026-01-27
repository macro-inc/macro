import { invalidateContacts } from '@queries/contacts/contacts';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type { ParentProps } from 'solid-js';
import { match } from 'ts-pattern';

// NOTE: This is a POC.
// Needs to be fleshed out more. Also ideally the Provider from macto-entity should be
// moved into the queries package first.
export function QuerySyncProvider(props: ParentProps) {
  createConnectionWebsocketEffect((data) => {
    match(data).with({ type: 'contacts_invalidation' }, () => {
      invalidateContacts();
    });
  });

  return props.children;
}

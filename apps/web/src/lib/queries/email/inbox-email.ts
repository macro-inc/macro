import { useEmail } from '@core/context/user';
import type { Accessor } from 'solid-js';
import { queryReadyGate } from '../gate';
import { useEmailLinksQuery } from './link';

/**
 * The address "me" means in an inbox's mail: the inbox's own, which may not be
 * the Macro login. `undefined` while the inbox's address is still loading.
 */
export function useInboxEmail(
  linkId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const macroEmail = useEmail();
  const links = useEmailLinksQuery();
  return () => {
    const id = linkId();
    if (id && links.isLoading) return undefined;
    const inbox =
      id && queryReadyGate(links)
        ? links.data.links.find((link) => link.id === id)
        : undefined;
    return inbox?.email_address ?? macroEmail();
  };
}

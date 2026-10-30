import type { Accessor } from 'solid-js';
import { queryReadyGate } from '../gate';
import { useEmailLinksQuery } from './link';

export function useInboxEmail(
  linkId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const links = useEmailLinksQuery();
  return () => {
    const id = linkId();
    if (!id || !queryReadyGate(links)) return undefined;
    return links.data.links.find((link) => link.id === id)?.email_address;
  };
}

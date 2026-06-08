import { useEmailLinksQuery } from '@queries/email/link';
import { createMemo } from 'solid-js';
import { macroIdToEmail, tryMacroId } from './macroId';

/** Predicate: is this macro id one of the current user's inbox-only delegated inboxes. */
export function useIsInboxOnlyLinkedChild() {
  const linksQuery = useEmailLinksQuery();

  const inboxOnlyEmails = createMemo(() => {
    const set = new Set<string>();
    for (const link of linksQuery.data?.links ?? []) {
      if (link.is_inbox_only) set.add(link.email_address.toLowerCase());
    }
    return set;
  });

  return (id: string | undefined | null): boolean => {
    if (!id) return false;
    const macroId = tryMacroId(id);
    if (!macroId) return false;
    return inboxOnlyEmails().has(macroIdToEmail(macroId).toLowerCase());
  };
}

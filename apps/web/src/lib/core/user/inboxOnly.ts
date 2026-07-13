import { useEmailLinksQuery } from '@queries/email/link';
import { createMemo } from 'solid-js';
import { macroIdToEmail, tryMacroId } from './macroId';

/**
 * Predicate: is this macro id a connected secondary inbox (an extra mailbox the
 * current user attached to their own account, `!is_primary`) rather than a real
 * user. Not to be confused with a delegated/shared inbox, which is a separate
 * loggable user (its own macro id) and reports `is_primary = true`.
 */
export function useIsConnectedSecondaryInbox() {
  const linksQuery = useEmailLinksQuery();

  const inboxOnlyEmails = createMemo(() => {
    const set = new Set<string>();
    for (const link of linksQuery.data?.links ?? []) {
      if (!link.is_primary) set.add(link.email_address.toLowerCase());
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

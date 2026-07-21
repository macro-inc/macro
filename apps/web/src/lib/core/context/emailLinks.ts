import { useEmailLinksQuery } from '@queries/email/link';
import type { Link } from '@service-email/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';
import { macroIdToEmail, tryMacroId } from '../user/macroId';
import { createAssertedContextProvider } from './createContext';
import { useIsAuthenticated } from './user';

const EMPTY_LINKS: Link[] = [];

type EmailLinksContextValue = {
  links: Accessor<Link[]>;
  isConnectedSecondaryInbox: (id: string | undefined | null) => boolean;
};

/**
 * Owns app-wide email-link identity metadata used by shared UI such as avatars.
 * Feature screens that need query status or refetch controls keep their own
 * query observer.
 */
export const [EmailLinksContextProvider, useEmailLinksContext] =
  createAssertedContextProvider(
    'EmailLinksContext',
    (): EmailLinksContextValue => {
      const isAuthenticated = useIsAuthenticated();
      const linksQuery = useEmailLinksQuery(() => isAuthenticated() === true);

      const links = (): Link[] =>
        isAuthenticated() === true
          ? (linksQuery.data?.links ?? EMPTY_LINKS)
          : EMPTY_LINKS;

      const secondaryInboxEmails = createMemo(() => {
        const emails = new Set<string>();
        for (const link of links()) {
          if (!link.is_primary) {
            emails.add(link.email_address.toLowerCase());
          }
        }
        return emails;
      });

      const isConnectedSecondaryInbox = (
        id: string | undefined | null
      ): boolean => {
        if (!id) return false;
        const macroId = tryMacroId(id);
        if (!macroId) return false;
        return secondaryInboxEmails().has(
          macroIdToEmail(macroId).toLowerCase()
        );
      };

      return { links, isConnectedSecondaryInbox };
    }
  );

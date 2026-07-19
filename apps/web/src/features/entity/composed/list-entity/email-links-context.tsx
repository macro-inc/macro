import { useEmailLinksQuery } from '@queries/email/link';
import type { Link } from '@service-email/generated/schemas';
import {
  type Accessor,
  createContext,
  type FlowComponent,
  useContext,
} from 'solid-js';

type EmailLinks = Accessor<Link[]>;

const EmailLinksContext = createContext<EmailLinks>();

/** Provides already-loaded email links to an entity-list subtree. */
export const EmailLinksProvider: FlowComponent<{ links: EmailLinks }> = (
  props
) => (
  <EmailLinksContext.Provider value={props.links}>
    {props.children}
  </EmailLinksContext.Provider>
);

/** Explicit query-owning adapter for standalone entity lists. */
export const EmailLinksQueryProvider: FlowComponent = (props) => {
  const linksQuery = useEmailLinksQuery();
  const links = (): Link[] => linksQuery.data?.links ?? [];

  return (
    <EmailLinksProvider links={links}>{props.children}</EmailLinksProvider>
  );
};

/** Returns links from the nearest entity-list metadata provider. */
export function useEmailLinks(): EmailLinks {
  const links = useContext(EmailLinksContext);
  if (!links) {
    throw new Error(
      'useEmailLinks can only be used under an EmailLinksProvider'
    );
  }

  return links;
}

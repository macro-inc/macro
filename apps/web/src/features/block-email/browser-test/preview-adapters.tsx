import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { Avatar } from '@ui';
import { type JSX, Show } from 'solid-js';

// Sample thread, viewer, and CRM records, with placeholders for the app
// services around them. The side panel and the People section render their
// real UI.
const VIEWER = 'me@example.com';

const messages: Pick<EmailMessage, 'from' | 'to' | 'cc'>[] = [
  {
    from: { email: 'ada@example.com', name: 'Ada Lovelace' },
    to: [{ email: VIEWER, name: 'Me' }],
    cc: [{ email: 'grace@example.org', name: 'Grace Hopper' }],
  },
  {
    from: { email: VIEWER, name: 'Me' },
    to: [{ email: 'ada@example.com' }],
    cc: [{ email: 'grace@example.org' }, { email: 'unknown@example.net' }],
  },
];

const crmContacts: Record<
  string,
  { id: string; name: string; companyId: string; lastInteraction: string }
> = {
  'ada@example.com': {
    id: 'contact-ada',
    name: 'Ada Lovelace',
    companyId: 'company-engines',
    lastInteraction: '2026-10-30T15:00:00Z',
  },
};
const crmCompanies: Record<
  string,
  { id: string; name: string; domains: { domain: string }[] }
> = {
  'company-engines': {
    id: 'company-engines',
    name: 'Analytical Engines',
    domains: [{ domain: 'engines.example.com' }],
  },
};

export function useEmailThreadState() {
  return { messages: { list: () => messages } };
}

export function useEmailThreadViewContext() {
  return { thread: { viewerEmail: () => VIEWER } };
}

export function createCrmPerson(email: () => string | undefined) {
  const contact = () => crmContacts[email() ?? ''];
  return {
    contact,
    company: () => {
      const companyId = contact()?.companyId;
      return companyId ? crmCompanies[companyId] : undefined;
    },
  };
}

function announce(message: string) {
  document.dispatchEvent(
    new CustomEvent('email-people-preview-message', { detail: message })
  );
}

export function useSplitLayout() {
  return {
    openWithSplit: (content: { type: string; id: string }) =>
      announce(`Opened ${content.type} ${content.id}`),
  };
}

export function EmailUserTooltip(props: {
  children: JSX.Element;
  triggerClass?: string;
}) {
  return <span class={props.triggerClass}>{props.children}</span>;
}

export function UserIcon(props: { email?: string; id?: string }) {
  const email = () => props.email ?? props.id?.replace(/^macro\|/, '') ?? '';
  return (
    <Show when={email()}>
      <Avatar size="lg">
        <Avatar.Fallback>{email().slice(0, 1).toUpperCase()}</Avatar.Fallback>
      </Avatar>
    </Show>
  );
}

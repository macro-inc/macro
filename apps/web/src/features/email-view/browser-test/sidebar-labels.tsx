// The Mail sidebar's Labels section over a label list and two connected
// inboxes, with and without an inbox picked; no network.
import '@app/index.css';
import { ViewSidebar } from '@app/components/view-shell';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { inboxLabelsOf } from '@queries/email/label-names';
import type { ApiLabel } from '@service-email/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { EmailSidebarLabels } from '../components/EmailSidebarLabels';

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|sidebar-labels@example.test',
  email: 'sidebar-labels@example.test',
  authenticated: true,
});

const LINKS = [
  { id: 'work', email_address: 'sam@acme.test', provider: 'GMAIL' },
  { id: 'home', email_address: 'rivera@northwind.test', provider: 'OUTLOOK' },
];

const label = (
  id: string,
  linkId: string,
  name: string,
  overrides: Partial<ApiLabel> = {}
) =>
  ({
    id,
    linkId,
    providerLabelId: id,
    name,
    createdAt: '2026-11-01T00:00:00Z',
    messageListVisibility: 'Show',
    labelListVisibility: 'LabelShow',
    type: 'User',
    ...overrides,
  }) as ApiLabel;

// Nine Gmail labels Gmail lists, one it hides, a nested pair, and Gmail's own,
// filtered as `useEmailInboxLabels` filters `GET /email/labels`.
const LABELS = inboxLabelsOf(
  [
    label('customers', 'work', 'Customers'),
    label('larkspur', 'work', 'Customers/Larkspur'),
    label('escalations', 'work', 'Escalations'),
    label('hiring', 'work', 'Hiring'),
    label('invoices', 'work', 'Invoices'),
    label('legal', 'work', 'Legal'),
    label('partners', 'work', 'Partners'),
    label('q3', 'work', 'Q3 planning'),
    label('receipts', 'work', 'Receipts'),
    label('travel', 'work', 'Travel'),
    label('archive', 'work', 'Archive', { labelListVisibility: 'LabelHide' }),
    label('inbox', 'work', 'INBOX', { type: 'System' }),
    label('board', 'home', 'Board'),
    label('follow-up', 'home', 'Follow up'),
  ].filter((entry) => entry.type === 'User'),
  LINKS
);

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Dark');

function Sidebar(props: { testId: string; picked?: string[] }) {
  const [active, setActive] = createSignal<readonly string[]>([]);
  const [open, setOpen] = createSignal(true);
  return (
    <div data-testid={props.testId} class="w-64 border border-edge-muted">
      <ViewSidebar.Root aria-label="Email navigation">
        <ViewSidebar.Content>
          <EmailSidebarLabels
            labels={LABELS.filter(
              (entry) => !props.picked || props.picked.includes(entry.linkId)
            )}
            addressOf={(linkId) =>
              LINKS.find((entry) => entry.id === linkId)?.email_address ?? ''
            }
            activeIds={active()}
            onSelect={(id) =>
              setActive((current) => (current.includes(id) ? [] : [id]))
            }
            open={open()}
            onOpenChange={setOpen}
          />
        </ViewSidebar.Content>
      </ViewSidebar.Root>
    </div>
  );
}

function Fixture() {
  return (
    <div class="flex flex-wrap gap-6 bg-page p-6">
      <Sidebar testId="all-inboxes" />
      <Sidebar testId="one-inbox" picked={['work']} />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <EmailLinksContextProvider>
          <Fixture />
        </EmailLinksContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  ),
  root
);

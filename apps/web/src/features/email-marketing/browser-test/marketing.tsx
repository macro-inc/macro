import '@app/index.css';
import '@fontsource-variable/inter';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { authKeys } from '@queries/auth/keys';
import { channelKeys } from '@queries/channel/keys';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createTestContentSession } from './collaboration';

const dark = new URLSearchParams(location.search).get('theme') === 'dark';
for (const [token, value] of Object.entries(
  (dark ? macroDarkTheme : macroLightTheme).colorTokens
))
  document.documentElement.style.setProperty(`--color-${token}`, value);
document.documentElement.dataset.themeLight = dark ? 'false' : 'true';
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

import { visibleNavItems } from '@components/app/sidebar-next/nav-items';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ContactEnrollments } from '../components/contact-enrollments';
import {
  primaryButton,
  secondaryButton,
} from '../components/enrollment-dialog';
import type { MarketingCapabilities } from '../context/contracts';
import type { Campaign, Enrollment, MarketingSnapshot } from '../core/model';
import { MarketingWorkspaceView } from '../views/marketing-workspace';

// Real production view and workflow, with isolated storage and a simulated Gmail scheduler.
// This fixture never connects to a user's account or sends real mail.
const contacts = [
  {
    name: 'Alex Morgan',
    email: 'alex@example.com',
    crmContactId: 'crm-alex',
    companyId: 'acme',
  },
  {
    name: 'Jamie Chen',
    email: 'jamie@example.com',
    crmContactId: 'crm-jamie',
    companyId: 'northstar',
  },
  { name: 'Sam Rivera', email: 'sam@example.com' },
];
const campaign: Campaign = {
  id: 'example-welcome',
  name: 'Customer onboarding',
  description: 'Help new customers find their first moment of value.',
  status: 'draft',
  senderId: 'gmail-test',
  updatedAt: new Date().toISOString(),
  steps: [
    {
      id: 'welcome',
      delayDays: 0,
      subject: 'Welcome to Macro, {{firstName}}',
      body: 'Hi {{firstName}},\n\nWelcome aboard. Your team’s work finally has a home — docs, conversations, and the people behind them.\n\nStart by connecting your inbox. If you need a hand, just reply.\n\nThe Macro team',
    },
    {
      id: 'tips',
      delayDays: 2,
      subject: 'Your first week, a little easier',
      body: 'Hi {{firstName}},\n\nA quick tip: keep your notes and conversations together in one project. It makes the next step easier to find.\n\nHow is your first week going?',
    },
  ],
};
const initial: MarketingSnapshot = {
  campaigns: [
    campaign,
    {
      ...campaign,
      id: 'example-reengagement',
      name: 'A friendly check-in',
      description: 'Reconnect with people who haven’t stopped by in a while.',
      steps: [campaign.steps[1]],
    },
  ],
  enrollments: [],
  databaseId: 'test-database',
  writable: true,
};
function read(): MarketingSnapshot {
  return JSON.parse(
    localStorage.getItem('marketing-test') ?? JSON.stringify(initial)
  );
}
const [snapshot, setSnapshot] = createSignal(read());
function write(value: MarketingSnapshot) {
  localStorage.setItem('marketing-test', JSON.stringify(value));
  setSnapshot(value);
}
type Draft = {
  id: string;
  email: string;
  subject: string;
  body: string;
  sendAt?: string;
};
const [outbox, setOutbox] = createSignal<Draft[]>(
  JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]')
);
function writeOutbox(value: Draft[]) {
  localStorage.setItem('marketing-test-outbox', JSON.stringify(value));
  setOutbox(value);
}
const [panel, setPanel] = createSignal('email-marketing');
const [crmEmail, setCrmEmail] = createSignal('alex@example.com');
const capabilities: MarketingCapabilities = {
  composition: { createSession: createTestContentSession },
  repository: {
    async load() {
      return read();
    },
    async saveCampaign(value) {
      const data = read();
      write({
        ...data,
        campaigns: [
          ...data.campaigns.filter((campaign) => campaign.id !== value.id),
          structuredClone(value),
        ],
      });
    },
    async saveEnrollment(value: Enrollment) {
      const data = read();
      write({
        ...data,
        enrollments: [
          ...data.enrollments.filter((entry) => entry.id !== value.id),
          structuredClone(value),
        ],
      });
    },
  },
  delivery: {
    async createDraft(_, email, subject, body) {
      const id = crypto.randomUUID();
      writeOutbox([...outbox(), { id, email, subject, body }]);
      return id;
    },
    async schedule(_, id, sendAt) {
      writeOutbox(
        outbox().map((draft) =>
          draft.id === id ? { ...draft, sendAt } : draft
        )
      );
    },
    async cancel(_, id) {
      writeOutbox(outbox().filter((draft) => draft.id !== id));
      return 'canceled';
    },
  },
  async loadContacts() {
    return contacts;
  },
  async searchCrmContacts(query) {
    return contacts.filter(
      (contact) =>
        contact.crmContactId &&
        `${contact.email} ${contact.name}`
          .toLowerCase()
          .includes(query.toLowerCase())
    );
  },
  async loadSenders() {
    return [{ id: 'gmail-test', email: 'hello@macro.example', ready: true }];
  },
  openContact(contact) {
    setCrmEmail(contact.email);
    setPanel('companies');
  },
  openDatabase() {
    setPanel('database');
  },
};
function Fixture() {
  const nav = visibleNavItems({
    showCalendar: true,
    showCustomers: true,
    showReminders: true,
  });
  return (
    <div
      class="flex h-screen flex-col bg-page text-ink"
      style={{ '--font-sans': 'Inter Variable, sans-serif' }}
    >
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-edge-muted bg-panel/50 px-5 text-[11px] text-ink-muted">
        <span>Macro · Email Marketing v1</span>
        <span>TEST WORKSPACE · simulated Gmail · no real emails sent</span>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside
          class="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-edge-muted bg-panel/20 py-4"
          aria-label="Outer sidebar"
        >
          <div class="mb-4 flex size-8 items-center justify-center rounded-lg bg-ink text-page font-semibold">
            M
          </div>
          <For each={nav}>
            {(item) => (
              <button
                type="button"
                aria-label={item.label}
                title={item.label}
                class="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-panel"
                classList={{ 'bg-panel text-ink': panel() === item.id }}
                onClick={() => setPanel(item.id)}
              >
                <item.icon class="size-5" />
              </button>
            )}
          </For>
          <button
            type="button"
            class="mt-auto text-xs text-ink-muted"
            onClick={() => setPanel('outbox')}
            aria-label="Test scheduler outbox"
          >
            ✉
          </button>
        </aside>
        <div class="min-h-0 min-w-0 flex-1">
          <Show when={panel() === 'email-marketing'}>
            <MarketingWorkspaceView capabilities={capabilities} />
          </Show>
          <Show when={panel() === 'companies'}>
            <div class="mx-auto max-w-3xl p-10">
              <div class="mb-8 flex items-center justify-between">
                <p class="text-sm text-ink-muted">
                  CRM / Contacts /{' '}
                  {
                    contacts.find((contact) => contact.email === crmEmail())
                      ?.name
                  }
                </p>
                <button
                  type="button"
                  class={secondaryButton}
                  onClick={() => setPanel('email-marketing')}
                >
                  Back to Email Marketing
                </button>
              </div>
              <h1 class="text-3xl font-semibold">
                {contacts.find((contact) => contact.email === crmEmail())?.name}
              </h1>
              <p class="mt-3 text-sm text-ink-muted">{crmEmail()}</p>
              <div class="mt-8">
                <ContactEnrollments
                  entries={snapshot().enrollments.filter(
                    (entry) => entry.contact.email === crmEmail()
                  )}
                  onOpen={() => setPanel('email-marketing')}
                />
              </div>
              <div class="mt-5 rounded-xl border border-edge-muted p-6">
                <h2 class="text-sm font-medium">Contact details</h2>
                <p class="mt-3 text-xs text-ink-muted">Company · Acme Studio</p>
                <p class="mt-3 text-xs text-ink-muted">
                  Source · Connected inbox
                </p>
              </div>
            </div>
          </Show>
          <Show when={panel() === 'database'}>
            <div class="p-8">
              <h1 class="text-2xl font-semibold">
                Macro Database · Email Marketing
              </h1>
              <p class="mt-2 text-sm text-ink-muted">
                Test records matching the production campaign and enrollment
                data.
              </p>
              <div class="mt-6 overflow-x-auto rounded-xl border border-edge-muted">
                <table class="w-full text-left text-sm">
                  <thead class="bg-panel text-xs text-ink-muted">
                    <tr>
                      <th class="p-4">Campaign</th>
                      <th>Status</th>
                      <th>Sequence</th>
                      <th>Enrolled</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={snapshot().campaigns}>
                      {(campaign) => (
                        <tr class="border-t border-edge-muted">
                          <td class="p-4">{campaign.name}</td>
                          <td>{campaign.status}</td>
                          <td>{campaign.steps.length} emails</td>
                          <td>
                            {
                              snapshot().enrollments.filter(
                                (entry) => entry.campaignId === campaign.id
                              ).length
                            }
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                class={`${secondaryButton} mt-5`}
                onClick={() => setPanel('email-marketing')}
              >
                Back to Email Marketing
              </button>
            </div>
          </Show>
          <Show when={panel() === 'outbox'}>
            <div class="p-8">
              <h1 class="text-2xl font-semibold">Test Gmail scheduler</h1>
              <p class="mt-2 text-sm text-ink-muted">
                Simulated draft and scheduling calls from the production
                sequence engine.
              </p>
              <For each={outbox()}>
                {(draft) => (
                  <article class="my-4 rounded-xl border border-edge-muted p-5">
                    <p class="text-sm font-medium">{draft.subject}</p>
                    <p class="mt-2 text-xs text-ink-muted">
                      To: {draft.email} · Scheduled: {draft.sendAt}
                    </p>
                    <p class="mt-4 whitespace-pre-wrap text-sm leading-6">
                      {draft.body}
                    </p>
                  </article>
                )}
              </For>
              <button
                type="button"
                class={primaryButton}
                onClick={() => setPanel('email-marketing')}
              >
                Back to Email Marketing
              </button>
            </div>
          </Show>
          <Show
            when={
              !['email-marketing', 'companies', 'database', 'outbox'].includes(
                panel()
              )
            }
          >
            <div class="p-10">
              <h1 class="text-xl font-medium">
                {nav.find((item) => item.id === panel())?.label}
              </h1>
              <p class="mt-2 text-sm text-ink-muted">
                Other modules are outside this isolated test workspace.
              </p>
              <button
                type="button"
                class={`${primaryButton} mt-6`}
                onClick={() => setPanel('email-marketing')}
              >
                Open Email Marketing
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
const fixturePeer =
  new URLSearchParams(location.search).get('peer') === 'jamie'
    ? 'jamie'
    : 'alex';
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: `macro|${fixturePeer}@example.com`,
  email: `${fixturePeer}@example.com`,
  name: fixturePeer === 'jamie' ? 'Jamie Chen' : 'Alex Morgan',
  authenticated: true,
  permissions: [],
  tutorialComplete: true,
});
queryClient.setQueryDefaults(channelKeys._def, { enabled: false });
queryClient.setQueryData(channelKeys.listChannels.queryKey, []);
queryClient.setQueryData(channelKeys.activity.queryKey, []);
const emptyQuickAccess: QuickAccessContextValue = {
  useList: () => ({
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    loadMore: async () => {},
  }),
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh() {},
  getById: () => undefined,
};
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <AnalyticsContextProvider>
          <ChannelsContextProvider>
            <QuickAccessContextProvider value={emptyQuickAccess}>
              <Fixture />
            </QuickAccessContextProvider>
          </ChannelsContextProvider>
        </AnalyticsContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);

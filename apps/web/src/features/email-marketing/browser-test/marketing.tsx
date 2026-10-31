import '@app/index.css';
import '@fontsource-variable/inter';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { visibleNavItems } from '@components/app/sidebar-next/nav-items';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ContactEnrollments } from '../components/contact-enrollments';
import type { MarketingCapabilities } from '../context/contracts';
import {
  type Campaign,
  campaignSchema,
  type DeliveryIssue,
  EMPTY_SNAPSHOT,
  type MarketingSnapshot,
} from '../core/model';
import { MarketingWorkspaceView } from '../views/marketing-workspace';

const params = new URLSearchParams(location.search);
const dark = params.get('theme') === 'dark';
for (const [token, value] of Object.entries(
  (dark ? macroDarkTheme : macroLightTheme).colorTokens
))
  document.documentElement.style.setProperty(`--color-${token}`, value);
document.documentElement.dataset.themeLight = dark ? 'false' : 'true';
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
// The app sets this at startup; `touch:` styles key off it.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

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
/** Found only by searching CRM, as in a CRM larger than the contacts list. */
const crmOnly = [
  { name: 'Riley Park', email: 'riley@example.com', crmContactId: 'crm-riley' },
  {
    name: 'Taylor Brooks',
    email: 'taylor@example.com',
    crmContactId: 'crm-taylor',
  },
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
      body: 'Hi {{firstName}},\n\nWelcome aboard.\n\nStart by connecting your inbox. If you need a hand, just reply.',
    },
    {
      id: 'tips',
      delayDays: 2,
      subject: '',
      body: 'Hi {{firstName}},\n\nHow is your first week going?',
      asReply: true,
    },
  ],
};
const initial: MarketingSnapshot = {
  ...EMPTY_SNAPSHOT,
  campaigns: [
    campaign,
    {
      ...campaign,
      id: 'example-reengagement',
      name: 'A friendly check-in',
      description: 'Reconnect with people who haven’t stopped by in a while.',
      steps: [{ ...campaign.steps[1], subject: 'Checking in', asReply: false }],
    },
  ],
  databaseId: 'test-database',
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
  threadId: string;
  replyingToId?: string;
  sendAt?: string;
};
function readOutbox(): Draft[] {
  return JSON.parse(localStorage.getItem('marketing-test-outbox') ?? '[]');
}
const [outbox, setOutbox] = createSignal<Draft[]>(readOutbox());
function writeOutbox(value: Draft[]) {
  localStorage.setItem('marketing-test-outbox', JSON.stringify(value));
  setOutbox(value);
}
/** Draft ids the simulated scheduler reports as failed sends. */
function failed(): string[] {
  return JSON.parse(localStorage.getItem('marketing-test-failed') ?? '[]');
}
const [panel, setPanel] = createSignal('email-marketing');
const [crmEmail, setCrmEmail] = createSignal('alex@example.com');
const [opened, setOpened] = createSignal('');
const capabilities: MarketingCapabilities = {
  repository: {
    async load() {
      return read();
    },
    async saveCampaign(value) {
      // Validated as the database repository does.
      const campaign = campaignSchema.parse(value);
      const data = read();
      write({
        ...data,
        campaigns: [
          ...data.campaigns.filter((item) => item.id !== campaign.id),
          campaign,
        ],
      });
    },
    async saveEnrollment(value) {
      const data = read();
      write({
        ...data,
        enrollments: [
          ...data.enrollments.filter((entry) => entry.id !== value.id),
          structuredClone(value),
        ],
      });
    },
    async deleteCampaign(campaignId, enrollmentIds) {
      const data = read();
      write({
        ...data,
        campaigns: data.campaigns.filter((item) => item.id !== campaignId),
        enrollments: data.enrollments.filter(
          (entry) => !enrollmentIds.includes(entry.id)
        ),
      });
    },
    async saveUnsubscribe(value) {
      const data = read();
      write({ ...data, unsubscribed: [...data.unsubscribed, value] });
    },
  },
  delivery: {
    async createDraft(_, content) {
      const id = crypto.randomUUID();
      const parent = readOutbox().find(
        (draft) => draft.id === content.replyingToId
      );
      if (content.replyingToId && !parent?.sendAt)
        throw new Error('Test: replies need a scheduled parent.');
      const threadId = parent?.threadId ?? `thread-${id}`;
      writeOutbox([...readOutbox(), { id, threadId, ...content }]);
      return { id, generation: 0, threadId };
    },
    async schedule(_, { draftId }, sendAt) {
      writeOutbox(
        readOutbox().map((draft) =>
          draft.id === draftId ? { ...draft, sendAt } : draft
        )
      );
    },
    async cancel(_, { draftId }) {
      writeOutbox(readOutbox().filter((draft) => draft.id !== draftId));
      return 'canceled';
    },
    async scheduled() {
      return new Set(
        readOutbox()
          .filter((draft) => draft.sendAt)
          .map((draft) => draft.id)
      );
    },
    async inspect(_, steps) {
      const issues: Record<string, DeliveryIssue> = {};
      for (const step of steps)
        if (failed().includes(step.draftId)) issues[step.draftId] = 'failed';
      const live = new Set(steps.map((step) => step.draftId));
      return {
        issues,
        sent: [],
        untracked: readOutbox()
          .filter((draft) => draft.sendAt && !live.has(draft.id))
          .map((draft) => draft.id),
      };
    },
  },
  async loadContacts() {
    return contacts;
  },
  async searchCrmContacts(query) {
    return [...contacts, ...crmOnly].filter(
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
  openThread(threadId) {
    setOpened(threadId);
    setPanel('outbox');
  },
};
let leave: (() => Promise<boolean>) | undefined;
/** Leaving the workspace runs its leave guard first, as the split router does. */
async function navigate(id: string) {
  if (panel() === 'email-marketing' && !(await (leave?.() ?? true))) return;
  setPanel(id);
}
function Back() {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => setPanel('email-marketing')}
    >
      Back to Email Marketing
    </Button>
  );
}
function Fixture() {
  const nav = visibleNavItems({
    showCalendar: true,
    showScheduling: true,
    showCustomers: true,
    showCalls: true,
    showReviews: true,
    showActivity: true,
    showExternal: true,
    showEmailMarketing: true,
    prefs: { hidden: new Set(), order: [] },
  });
  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <div class="flex h-9 shrink-0 items-center justify-between border-b border-edge-muted bg-panel/50 px-5 text-[11px] text-ink-muted">
        <span>Macro · Email Marketing</span>
        <span>TEST WORKSPACE · simulated Gmail · no real emails sent</span>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside
          class="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-edge-muted bg-panel/20 py-4"
          aria-label="Outer sidebar"
        >
          <For each={nav}>
            {(item) => (
              <Button
                type="button"
                variant="ghost"
                size="icon-md"
                aria-label={item.label}
                onClick={() => fireAndForget(navigate(item.id), 'fixture')}
              >
                <item.icon class="size-5" />
              </Button>
            )}
          </For>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            class="mt-auto"
            aria-label="Test scheduler outbox"
            onClick={() => fireAndForget(navigate('outbox'), 'fixture')}
          >
            ✉
          </Button>
        </aside>
        <div class="min-h-0 min-w-0 flex-1">
          <Show when={panel() === 'email-marketing'}>
            <MarketingWorkspaceView
              capabilities={capabilities}
              registerLeave={(guard) => {
                leave = guard;
              }}
            />
          </Show>
          <Show when={panel() === 'companies'}>
            <div class="mx-auto max-w-3xl space-y-6 p-10">
              <Back />
              <h1 class="text-3xl font-semibold">
                {contacts.find((contact) => contact.email === crmEmail())?.name}
              </h1>
              <ContactEnrollments
                entries={snapshot().enrollments.filter(
                  (entry) => entry.contact.email === crmEmail()
                )}
                attention={(entry) =>
                  entry.steps.some(
                    (step) => step.draftId && failed().includes(step.draftId)
                  )
                    ? 'failed'
                    : undefined
                }
                onOpen={() => setPanel('email-marketing')}
              />
            </div>
          </Show>
          <Show when={panel() === 'database'}>
            <div class="space-y-4 p-8">
              <h1 class="text-2xl font-semibold">
                Macro Database · Email Marketing
              </h1>
              <Back />
            </div>
          </Show>
          <Show when={panel() === 'outbox'}>
            <div class="space-y-4 p-8">
              <h1 class="text-2xl font-semibold">Test Gmail scheduler</h1>
              <p class="text-sm text-ink-muted" data-testid="opened-thread">
                {opened()}
              </p>
              <For each={outbox()}>
                {(draft) => (
                  <article class="rounded-xl border border-edge-muted p-5">
                    <p class="text-sm font-medium">{draft.subject}</p>
                    <p class="mt-2 text-xs text-ink-muted">
                      To: {draft.email} · Scheduled: {draft.sendAt} · Thread:{' '}
                      {draft.threadId}
                    </p>
                    <p class="mt-4 whitespace-pre-wrap text-sm leading-6">
                      {draft.body}
                    </p>
                  </article>
                )}
              </For>
              <Back />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|alex@example.com',
  email: 'alex@example.com',
  name: 'Alex Morgan',
  authenticated: true,
  permissions: [],
  tutorialComplete: true,
});
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <Fixture />
            <ToastRegion />
          </PosthogProvider>
        </AnalyticsContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);

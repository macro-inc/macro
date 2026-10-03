import { Dialog } from '@kobalte/core/dialog';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FlowArrowIcon from '@phosphor/flow-arrow.svg';
import GearIcon from '@phosphor/gear-six.svg';
import UsersIcon from '@phosphor/users.svg';
import { createSignal, For, onMount, Show } from 'solid-js';
import { CampaignList } from '../components/campaign-list';
import { ContactEnrollments } from '../components/contact-enrollments';
import {
  EnrollmentDialog,
  inputClass,
  primaryButton,
  secondaryButton,
} from '../components/enrollment-dialog';
import type { CompositionState } from '../components/sequence-content-editor';
import { SequenceEditor } from '../components/sequence-editor';
import { StatusBadge } from '../components/status-badge';
import type { MarketingCapabilities } from '../context/contracts';
import {
  type Campaign,
  type MarketingContact,
  normalizeEmail,
  personalize,
  type SequenceStep,
} from '../core/model';
import { createMarketingWorkspace } from '../primitives/workspace';

export function MarketingWorkspaceView(props: {
  capabilities: MarketingCapabilities;
}) {
  const workspace = createMarketingWorkspace(props.capabilities);
  const [section, setSection] = createSignal<
    'campaigns' | 'contacts' | 'delivery'
  >('campaigns');
  const [draft, setDraft] = createSignal<Campaign>();
  const [detailTab, setDetailTab] = createSignal<'sequence' | 'enrollments'>(
    'sequence'
  );
  const [filter, setFilter] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal('all');
  const [newOpen, setNewOpen] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [template, setTemplate] = createSignal('welcome');
  const [enrollOpen, setEnrollOpen] = createSignal(false);
  const [preview, setPreview] = createSignal<SequenceStep>();
  const [previewEmail, setPreviewEmail] = createSignal('');
  const [contactDetail, setContactDetail] = createSignal<MarketingContact>();
  const [compositionStates, setCompositionStates] = createSignal<
    Record<string, CompositionState>
  >({});
  const compositionKey = (
    campaignId: string,
    stepId: string,
    field: 'subject' | 'body'
  ) => `${campaignId}:${stepId}:${field}`;
  const compositionReady = () =>
    !props.capabilities.composition ||
    draft()?.status === 'active' ||
    (detailTab() === 'sequence' &&
      draft()?.steps.every((step) =>
        ['subject', 'body'].every(
          (field) =>
            compositionStates()[
              compositionKey(draft()!.id, step.id, field as 'subject' | 'body')
            ] === 'ready'
        )
      ));
  onMount(() => {
    void workspace.initialize();
  });
  const campaigns = () =>
    workspace
      .snapshot()
      .campaigns.filter(
        (campaign) =>
          `${campaign.name} ${campaign.description}`
            .toLowerCase()
            .includes(filter().toLowerCase()) &&
          (statusFilter() === 'all' || statusFilter() === campaign.status)
      );
  const entries = () =>
    workspace
      .snapshot()
      .enrollments.filter((entry) => entry.campaignId === draft()?.id);
  const futureQueued = () =>
    workspace
      .snapshot()
      .enrollments.flatMap((entry) => entry.steps)
      .filter(
        (step) =>
          step.status === 'queued' &&
          new Date(step.sendAt).getTime() > Date.now()
      ).length;
  const activeCount = () =>
    workspace
      .snapshot()
      .campaigns.filter((campaign) => campaign.status === 'active').length;
  const canEdit = () =>
    workspace.snapshot().writable &&
    !workspace.busy() &&
    draft()?.status !== 'active';
  const changed = () =>
    draft() &&
    JSON.stringify(draft()) !==
      JSON.stringify(
        workspace
          .snapshot()
          .campaigns.find((campaign) => campaign.id === draft()?.id)
      );
  const openCampaign = (campaign: Campaign) => {
    setCompositionStates({});
    setDraft(structuredClone(campaign));
    setDetailTab('sequence');
  };
  const save = async (activate: boolean) => {
    const campaign = draft();
    if (!campaign) return;
    if (!compositionReady()) return;
    if (
      await workspace.run(
        () => workspace.save(campaign, activate),
        activate
          ? 'Campaign is active. Enroll contacts to start the sequence.'
          : 'Campaign saved.'
      )
    )
      setDraft(
        workspace.snapshot().campaigns.find((item) => item.id === campaign.id)
      );
  };
  const go = async (next: 'campaigns' | 'contacts' | 'delivery') => {
    if (changed() && canEdit()) {
      if (!compositionReady()) {
        await workspace.run(async () => {
          throw new Error(
            'Open the sequence and wait for its shared drafts to load before saving.'
          );
        }, '');
        return;
      }
      const campaign = draft()!;
      if (
        !(await workspace.run(
          () => workspace.save(campaign, false),
          'Campaign saved.'
        ))
      )
        return;
    }
    setDraft(undefined);
    setSection(next);
    setFilter('');
  };
  const previewContact = () =>
    workspace.contacts().find((contact) => contact.email === previewEmail()) ??
    workspace.contacts()[0] ?? {
      email: 'alex@example.com',
      name: 'Alex Morgan',
    };
  return (
    <main
      class="flex h-full min-h-0 w-full flex-col bg-page text-ink"
      aria-label="Email Marketing"
    >
      <header class="flex shrink-0 items-center justify-between gap-3 border-b border-edge-muted px-6 py-4">
        <div class="flex items-center gap-3">
          <span class="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <EnvelopeIcon class="size-5" aria-hidden="true" />
          </span>
          <h1 class="text-base font-semibold">Email Marketing</h1>
          <span class="rounded-md border border-edge-muted px-1.5 py-0.5 text-[10px] text-ink-muted">
            BETA
          </span>
        </div>
        <Show when={workspace.snapshot().databaseId}>
          <button
            type="button"
            class="text-xs text-ink-muted hover:text-ink"
            onClick={() =>
              props.capabilities.openDatabase(workspace.snapshot().databaseId!)
            }
          >
            Open database ↗
          </button>
        </Show>
      </header>
      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          class="flex shrink-0 gap-1 border-b border-edge-muted bg-panel/30 p-3 sm:w-48 sm:flex-col sm:gap-1 sm:border-r sm:border-b-0 sm:p-4"
          aria-label="Email Marketing navigation"
        >
          <p class="mb-3 hidden px-3 text-[10px] font-medium uppercase tracking-widest text-ink-subtle sm:block">
            Your workspace
          </p>
          <For each={['campaigns', 'contacts', 'delivery'] as const}>
            {(item) => (
              <button
                type="button"
                aria-label={
                  item === 'campaigns'
                    ? 'Campaigns'
                    : item === 'contacts'
                      ? 'Contacts'
                      : 'Delivery'
                }
                aria-current={section() === item ? 'page' : undefined}
                disabled={workspace.busy()}
                class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-ink-muted disabled:opacity-50"
                classList={{ 'bg-page text-ink shadow-sm': section() === item }}
                onClick={() => void go(item)}
              >
                <span class="w-4 text-base" aria-hidden="true">
                  {item === 'campaigns' ? (
                    <FlowArrowIcon class="size-4" />
                  ) : item === 'contacts' ? (
                    <UsersIcon class="size-4" />
                  ) : (
                    <GearIcon class="size-4" />
                  )}
                </span>
                {item === 'campaigns'
                  ? 'Campaigns'
                  : item === 'contacts'
                    ? 'Contacts'
                    : 'Delivery'}
                <Show when={item === 'campaigns'}>
                  <span class="ml-auto text-xs text-ink-subtle">
                    {workspace.snapshot().campaigns.length}
                  </span>
                </Show>
              </button>
            )}
          </For>
          <div class="mt-auto hidden rounded-lg border border-edge-muted p-3 sm:block">
            <p class="text-xs font-medium">A little more personal.</p>
            <p class="mt-1 text-xs leading-5 text-ink-muted">
              The right email, at the right time. All from your own inbox.
            </p>
          </div>
        </nav>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <Show when={workspace.error()}>
            <div
              class="mx-6 mt-4 flex items-center justify-between gap-3 rounded-lg border border-failure/20 bg-failure/5 px-4 py-3 text-sm text-failure"
              role="alert"
            >
              {workspace.error()}
              <button
                type="button"
                class="shrink-0 underline"
                disabled={workspace.busy()}
                onClick={() => void workspace.initialize()}
              >
                Refresh
              </button>
            </div>
          </Show>
          <Show when={workspace.notice()}>
            <div
              class="mx-6 mt-4 rounded-lg bg-success/10 px-4 py-3 text-xs text-success"
              role="status"
            >
              {workspace.notice()}
            </div>
          </Show>
          <Show
            when={!workspace.loading()}
            fallback={
              <p class="p-8 text-sm text-ink-muted">Loading Email Marketing…</p>
            }
          >
            <Show when={section() === 'campaigns'}>
              <Show
                when={draft()}
                fallback={
                  <CampaignList
                    campaigns={campaigns()}
                    snapshot={workspace.snapshot()}
                    busy={workspace.busy()}
                    activeCount={activeCount()}
                    upcomingCount={futureQueued()}
                    filter={filter()}
                    statusFilter={statusFilter()}
                    onFilter={setFilter}
                    onStatusFilter={setStatusFilter}
                    onCreate={() => {
                      setNewName('');
                      setNewOpen(true);
                    }}
                    onOpen={openCampaign}
                  />
                }
              >
                {(campaign) => (
                  <>
                    <div class="shrink-0 border-b border-edge-muted px-6 pt-5">
                      <button
                        type="button"
                        class="mb-4 text-xs text-ink-muted hover:text-ink"
                        disabled={workspace.busy()}
                        onClick={() => void go('campaigns')}
                      >
                        ← All campaigns
                      </button>
                      <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="flex items-center gap-3">
                          <h2 class="text-xl font-semibold">
                            {campaign().name}
                          </h2>
                          <StatusBadge status={campaign().status} />
                          <Show when={changed()}>
                            <span class="text-xs text-ink-muted">
                              Unsaved changes
                            </span>
                          </Show>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          <Show
                            when={campaign().status === 'active'}
                            fallback={
                              <>
                                <button
                                  type="button"
                                  class={secondaryButton}
                                  disabled={!canEdit() || !compositionReady()}
                                  onClick={() => void save(false)}
                                >
                                  {workspace.busy() ? 'Saving…' : 'Save draft'}
                                </button>
                                <button
                                  type="button"
                                  class={primaryButton}
                                  disabled={!canEdit() || !compositionReady()}
                                  onClick={() => void save(true)}
                                >
                                  Activate campaign
                                </button>
                              </>
                            }
                          >
                            <button
                              type="button"
                              class={secondaryButton}
                              disabled={
                                workspace.busy() ||
                                !workspace.snapshot().writable
                              }
                              onClick={async () => {
                                if (
                                  await workspace.run(
                                    () => workspace.pause(campaign()),
                                    'Campaign paused. Future emails have been canceled.'
                                  )
                                )
                                  setDraft(
                                    workspace
                                      .snapshot()
                                      .campaigns.find(
                                        (item) => item.id === campaign().id
                                      )
                                  );
                              }}
                            >
                              Pause campaign
                            </button>
                            <button
                              type="button"
                              class={primaryButton}
                              disabled={
                                workspace.busy() ||
                                !workspace.snapshot().writable
                              }
                              onClick={() => setEnrollOpen(true)}
                            >
                              ＋ Enroll contacts
                            </button>
                          </Show>
                        </div>
                      </div>
                      <Show
                        when={
                          props.capabilities.composition &&
                          campaign().status !== 'active'
                        }
                      >
                        <p class="mt-3 text-xs text-ink-muted">
                          {compositionReady()
                            ? 'Subject and message edits are shared live. Save to update the sending snapshot.'
                            : detailTab() === 'sequence'
                              ? 'Loading shared draft content…'
                              : 'Open Sequence to load the shared draft before saving or activating.'}
                        </p>
                      </Show>
                      <div class="mt-5 flex gap-6">
                        <For each={['sequence', 'enrollments'] as const}>
                          {(tab) => (
                            <button
                              type="button"
                              class="border-b-2 border-transparent pb-3 text-sm text-ink-muted"
                              classList={{
                                'border-ink text-ink': detailTab() === tab,
                              }}
                              onClick={() => setDetailTab(tab)}
                            >
                              {tab === 'sequence'
                                ? 'Sequence'
                                : `Enrollments (${entries().length})`}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="flex-1 overflow-y-auto p-6 lg:p-8">
                      <Show
                        when={detailTab() === 'sequence'}
                        fallback={
                          <div class="space-y-4">
                            <div>
                              <h3 class="text-base font-medium">
                                People in this sequence
                              </h3>
                              <p class="mt-1 text-xs text-ink-muted">
                                Stopping or pausing cancels upcoming emails.
                                Emails already sent cannot be recalled.
                              </p>
                            </div>
                            <Show
                              when={entries().length}
                              fallback={
                                <p class="rounded-xl border border-dashed border-edge p-10 text-center text-sm text-ink-muted">
                                  No contacts enrolled yet.
                                </p>
                              }
                            >
                              <For each={entries()}>
                                {(entry) => (
                                  <article class="rounded-xl border border-edge-muted p-4">
                                    <div class="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <button
                                          type="button"
                                          class="text-sm font-medium hover:underline"
                                          onClick={() => {
                                            setContactDetail(entry.contact);
                                          }}
                                        >
                                          {entry.contact.name ||
                                            entry.contact.email}
                                        </button>
                                        <p class="mt-1 text-xs text-ink-muted">
                                          {entry.contact.email}
                                        </p>
                                      </div>
                                      <div class="flex items-center gap-2">
                                        <StatusBadge status={entry.status} />
                                        <Show
                                          when={entry.status === 'scheduled'}
                                        >
                                          <button
                                            type="button"
                                            class={secondaryButton}
                                            disabled={
                                              workspace.busy() ||
                                              !workspace.snapshot().writable
                                            }
                                            onClick={() =>
                                              void workspace.run(
                                                () =>
                                                  workspace.engine.stop(
                                                    entry,
                                                    'paused'
                                                  ),
                                                'Enrollment paused.'
                                              )
                                            }
                                          >
                                            Pause
                                          </button>
                                        </Show>
                                        <Show
                                          when={
                                            entry.status === 'paused' &&
                                            campaign().status === 'active'
                                          }
                                        >
                                          <button
                                            type="button"
                                            class={secondaryButton}
                                            disabled={
                                              workspace.busy() ||
                                              !workspace.snapshot().writable
                                            }
                                            onClick={() =>
                                              void workspace.run(async () => {
                                                await workspace.engine.resume(
                                                  entry
                                                );
                                              }, 'Future emails rescheduled.')
                                            }
                                          >
                                            Resume
                                          </button>
                                        </Show>
                                        <Show when={entry.status !== 'stopped'}>
                                          <button
                                            type="button"
                                            class={secondaryButton}
                                            disabled={
                                              workspace.busy() ||
                                              !workspace.snapshot().writable
                                            }
                                            onClick={() =>
                                              void workspace.run(
                                                () =>
                                                  workspace.engine.stop(
                                                    entry,
                                                    'stopped'
                                                  ),
                                                'Enrollment stopped. Upcoming emails canceled.'
                                              )
                                            }
                                          >
                                            Stop
                                          </button>
                                        </Show>
                                      </div>
                                    </div>
                                    <div class="mt-4 space-y-2 border-t border-edge-muted pt-3">
                                      <For each={entry.steps}>
                                        {(step, index) => (
                                          <div class="flex justify-between gap-3 text-xs">
                                            <span class="text-ink-muted">
                                              {index() + 1}. {step.subject}
                                            </span>
                                            <span class="text-ink-subtle">
                                              {step.status ===
                                              'delivery_started'
                                                ? 'Sending or sent'
                                                : step.status === 'canceled'
                                                  ? 'Canceled'
                                                  : `${new Date(step.sendAt).toLocaleString()} · ${step.status === 'queued' && new Date(step.sendAt).getTime() <= Date.now() ? 'Due' : step.status}`}
                                            </span>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                    <Show when={entry.error}>
                                      <p
                                        class="mt-3 text-xs text-failure"
                                        role="alert"
                                      >
                                        {entry.error}
                                      </p>
                                    </Show>
                                  </article>
                                )}
                              </For>
                            </Show>
                            <p class="text-xs text-ink-subtle">
                              Scheduled and due statuses are not delivery
                              receipts. Open your Gmail Sent folder to confirm
                              delivery.
                            </p>
                          </div>
                        }
                      >
                        <Show when={campaign().status === 'active'}>
                          <p class="mx-auto mb-5 max-w-3xl rounded-lg bg-panel px-4 py-3 text-xs text-ink-muted">
                            Pause this campaign to edit. Existing enrollments
                            keep their original email content.
                          </p>
                        </Show>
                        <SequenceEditor
                          campaign={campaign()}
                          senders={workspace.senders()}
                          disabled={!canEdit()}
                          databaseId={workspace.snapshot().databaseId}
                          composition={props.capabilities.composition}
                          onCompositionState={(stepId, field, state) =>
                            setCompositionStates((states) => ({
                              ...states,
                              [compositionKey(campaign().id, stepId, field)]:
                                state,
                            }))
                          }
                          onChange={setDraft}
                          onPreview={(step) => {
                            setPreviewEmail(
                              workspace.contacts()[0]?.email ?? ''
                            );
                            setPreview(step);
                          }}
                        />
                      </Show>
                    </div>
                    <Show when={enrollOpen()}>
                      <EnrollmentDialog
                        campaign={campaign()}
                        contacts={workspace.contacts()}
                        enrolledEmails={entries().map((entry) =>
                          normalizeEmail(entry.contact.email)
                        )}
                        busy={workspace.busy()}
                        error={workspace.error()}
                        onClose={() => setEnrollOpen(false)}
                        onSearchCrm={props.capabilities.searchCrmContacts}
                        onEnroll={(contacts, startAt) =>
                          workspace.run(
                            () =>
                              workspace.enroll(campaign(), contacts, startAt),
                            `${contacts.length} contact${contacts.length === 1 ? '' : 's'} enrolled. Emails scheduled.`
                          )
                        }
                      />
                    </Show>
                  </>
                )}
              </Show>
            </Show>
            <Show when={section() === 'contacts'}>
              <div class="flex-1 overflow-y-auto p-6 lg:p-9">
                <h2 class="text-2xl font-semibold tracking-tight">Contacts</h2>
                <p class="mt-2 text-sm text-ink-muted">
                  Your audience, connected across Macro.
                </p>
                <input
                  aria-label="Search marketing contacts"
                  class={`${inputClass} my-6 max-w-sm`}
                  placeholder="Search contacts"
                  value={filter()}
                  onInput={(event) => setFilter(event.currentTarget.value)}
                />
                <div class="overflow-hidden rounded-xl border border-edge-muted">
                  <For
                    each={workspace
                      .contacts()
                      .filter((contact) =>
                        `${contact.name} ${contact.email}`
                          .toLowerCase()
                          .includes(filter().toLowerCase())
                      )}
                  >
                    {(contact) => (
                      <button
                        type="button"
                        class="flex w-full items-center justify-between gap-3 border-b border-edge-muted px-5 py-4 text-left last:border-0 hover:bg-panel/30"
                        onClick={() => setContactDetail(contact)}
                      >
                        <span class="min-w-0">
                          <span class="block text-sm font-medium">
                            {contact.name || contact.email}
                          </span>
                          <span class="mt-1 block truncate text-xs text-ink-muted">
                            {contact.email}
                          </span>
                        </span>
                        <span class="flex items-center gap-3">
                          <Show when={contact.crmContactId}>
                            <span class="rounded-md bg-panel px-2 py-1 text-xs text-ink-muted">
                              CRM
                            </span>
                          </Show>
                          <span class="text-xs text-ink-muted">
                            {
                              workspace
                                .snapshot()
                                .enrollments.filter(
                                  (entry) =>
                                    entry.contact.email === contact.email
                                ).length
                            }{' '}
                            sequences
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                  <Show when={!workspace.contacts().length}>
                    <p class="p-10 text-center text-sm text-ink-muted">
                      Your Macro and Gmail contacts will appear here.
                    </p>
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={section() === 'delivery'}>
              <div class="mx-auto w-full max-w-3xl flex-1 overflow-y-auto p-6 lg:p-9">
                <h2 class="text-2xl font-semibold tracking-tight">Delivery</h2>
                <p class="mt-2 text-sm text-ink-muted">
                  Choose how your sequences reach people.
                </p>
                <section class="mt-7 rounded-xl border border-edge-muted p-6">
                  <div class="flex justify-between">
                    <h3 class="text-base font-medium">Connected Gmail</h3>
                    <span class="text-xs text-success">Available in v1</span>
                  </div>
                  <p class="mt-2 text-sm leading-6 text-ink-muted">
                    Send personal sequences from an inbox you already use.
                    Scheduled emails continue when you close Macro.
                  </p>
                  <div class="mt-4 space-y-3">
                    <For each={workspace.senders()}>
                      {(sender) => (
                        <div class="flex items-center justify-between rounded-lg bg-panel/50 px-4 py-3">
                          <span class="text-sm">{sender.email}</span>
                          <span
                            class="text-xs"
                            classList={{
                              'text-success': sender.ready,
                              'text-warning': !sender.ready,
                            }}
                          >
                            {sender.ready ? 'Connected' : 'Reconnect required'}
                          </span>
                        </div>
                      )}
                    </For>
                    <Show when={!workspace.senders().length}>
                      <p class="rounded-lg bg-panel p-4 text-sm text-ink-muted">
                        Connect a Gmail inbox in Macro’s email settings to start
                        sending.
                      </p>
                    </Show>
                  </div>
                  <p class="mt-4 text-xs leading-5 text-ink-muted">
                    Gmail account sending limits and your existing Macro plan
                    apply. This version does not add a separate sequence billing
                    meter.
                  </p>
                </section>
                <section class="mt-4 rounded-xl border border-edge-muted p-6">
                  <div class="flex justify-between">
                    <h3 class="text-base font-medium">SendGrid</h3>
                    <span class="rounded-full bg-panel px-3 py-1 text-xs text-ink-muted">
                      Not connected
                    </span>
                  </div>
                  <p class="mt-2 text-sm leading-6 text-ink-muted">
                    Bulk sending needs a verified sending domain, a server-side
                    API connection, unsubscribe handling, and a provider billing
                    plan. It is not available in this version.
                  </p>
                </section>
                <section class="mt-4 rounded-xl border border-edge-muted p-6">
                  <h3 class="text-sm font-medium">Sequence controls</h3>
                  <p class="mt-2 text-xs leading-6 text-ink-muted">
                    Pause or stop enrollments to cancel future emails. Replies,
                    unsubscribe requests, and delivery failures are handled
                    manually. Open your Sent folder for confirmed delivery. This
                    version does not track opens or clicks.
                  </p>
                </section>
              </div>
            </Show>
          </Show>
        </div>
      </div>
      <Dialog
        open={newOpen()}
        onOpenChange={(open) => {
          if (!workspace.busy()) setNewOpen(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-100 bg-ink/20 backdrop-blur-sm" />
          <Dialog.Content class="fixed left-1/2 top-1/2 z-101 w-[min(480px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge-muted bg-page p-6 shadow-xl">
            <Dialog.Title class="text-lg font-semibold">
              Create a campaign
            </Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-ink-muted">
              Start with a sequence that feels like you.
            </Dialog.Description>
            <form
              class="mt-6 space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const campaign: Campaign = {
                  id: crypto.randomUUID(),
                  name: newName().trim(),
                  description: '',
                  senderId:
                    workspace.senders().find((sender) => sender.ready)?.id ??
                    '',
                  status: 'draft',
                  updatedAt: new Date().toISOString(),
                  steps:
                    template() === 'welcome'
                      ? [
                          {
                            id: crypto.randomUUID(),
                            delayDays: 0,
                            subject: 'Welcome, {{firstName}}',
                            body: 'Hi {{firstName}},\n\nThanks for joining us. I’m glad you’re here.\n\nWhat are you hoping to get out of your experience? Just reply — I’d love to hear.',
                          },
                          {
                            id: crypto.randomUUID(),
                            delayDays: 2,
                            subject: 'A little help getting started',
                            body: 'Hi {{firstName}},\n\nChecking in to see how things are going. If you have any questions, hit reply and I’ll help you get started.',
                          },
                        ]
                      : [
                          {
                            id: crypto.randomUUID(),
                            delayDays: 0,
                            subject: '',
                            body: '',
                          },
                        ],
                };
                if (
                  await workspace.run(
                    () => workspace.save(campaign, false),
                    'Campaign created.'
                  )
                ) {
                  setNewOpen(false);
                  openCampaign(
                    workspace
                      .snapshot()
                      .campaigns.find((item) => item.id === campaign.id)!
                  );
                }
              }}
            >
              <label class="block space-y-2 text-xs font-medium">
                Campaign name
                <input
                  aria-label="New campaign name"
                  class={inputClass}
                  value={newName()}
                  required
                  maxLength={120}
                  onInput={(event) => setNewName(event.currentTarget.value)}
                />
              </label>
              <label class="block space-y-2 text-xs font-medium">
                Starting point
                <select
                  aria-label="Campaign template"
                  class={inputClass}
                  value={template()}
                  onChange={(event) => setTemplate(event.currentTarget.value)}
                >
                  <option value="welcome">Welcome series · 2 emails</option>
                  <option value="blank">Blank sequence</option>
                </select>
              </label>
              <Show when={workspace.error()}>
                <p class="text-xs text-failure" role="alert">
                  {workspace.error()}
                </p>
              </Show>
              <div class="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  class={secondaryButton}
                  disabled={workspace.busy()}
                  onClick={() => setNewOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class={primaryButton}
                  disabled={!newName().trim() || workspace.busy()}
                >
                  Create campaign
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      <Dialog
        open={!!preview()}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-100 bg-ink/20 backdrop-blur-sm" />
          <Dialog.Content class="fixed left-1/2 top-1/2 z-101 max-h-[88vh] w-[min(650px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-edge-muted bg-page p-6 shadow-xl">
            <div class="flex justify-between">
              <Dialog.Title class="text-lg font-semibold">
                Email preview
              </Dialog.Title>
              <Dialog.CloseButton aria-label="Close preview">
                ✕
              </Dialog.CloseButton>
            </div>
            <Dialog.Description class="mt-1 text-xs text-ink-muted">
              See the personalized email your contact receives.
            </Dialog.Description>
            <select
              aria-label="Preview contact"
              class={`${inputClass} mt-5`}
              value={previewEmail()}
              onChange={(event) => setPreviewEmail(event.currentTarget.value)}
            >
              <Show when={!workspace.contacts().length}>
                <option value="">Alex Morgan · sample contact</option>
              </Show>
              <For each={workspace.contacts()}>
                {(contact) => (
                  <option value={contact.email}>
                    {contact.name || contact.email}
                  </option>
                )}
              </For>
            </select>
            <div class="mt-5 overflow-hidden rounded-xl border border-edge-muted">
              <div class="space-y-2 border-b border-edge-muted bg-panel/30 p-5">
                <p class="text-xs text-ink-muted">
                  To: {previewContact().email}
                </p>
                <p class="text-sm font-semibold">
                  {personalize(preview()?.subject ?? '', previewContact())}
                </p>
              </div>
              <div class="whitespace-pre-wrap p-6 text-sm leading-7">
                {personalize(preview()?.body ?? '', previewContact())}
                <p class="mt-6 text-xs text-ink-muted">
                  If you would prefer not to receive these emails, reply
                  unsubscribe.
                </p>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      <Dialog
        open={!!contactDetail()}
        onOpenChange={(open) => {
          if (!open) setContactDetail(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 z-100 bg-ink/20 backdrop-blur-sm" />
          <Dialog.Content class="fixed left-1/2 top-1/2 z-101 w-[min(520px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-edge-muted bg-page p-6 shadow-xl">
            <div class="flex justify-between">
              <Dialog.Title class="text-lg font-semibold">
                {contactDetail()?.name || contactDetail()?.email}
              </Dialog.Title>
              <Dialog.CloseButton aria-label="Close contact">
                ✕
              </Dialog.CloseButton>
            </div>
            <Dialog.Description class="mt-1 text-sm text-ink-muted">
              {contactDetail()?.email}
            </Dialog.Description>
            <div class="mt-5">
              <ContactEnrollments
                entries={workspace
                  .snapshot()
                  .enrollments.filter(
                    (entry) =>
                      normalizeEmail(entry.contact.email) ===
                      normalizeEmail(contactDetail()?.email ?? '')
                  )}
              />
            </div>
            <Show when={contactDetail()?.crmContactId}>
              <button
                type="button"
                class={`${secondaryButton} mt-5`}
                onClick={() => props.capabilities.openContact(contactDetail()!)}
              >
                Open CRM contact ↗
              </button>
            </Show>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </main>
  );
}

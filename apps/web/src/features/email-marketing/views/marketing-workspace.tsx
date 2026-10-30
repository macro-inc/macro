import { ViewShell } from '@app/components/view-shell';
import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { useViewControlHotkeys } from '@app/components/view-shell/use-view-control-hotkeys';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  Button,
  ConfirmDialog,
  DeleteDialog,
  EmptyStatePanel,
  Tabs,
} from '@ui';
import { createSignal, type JSX, Match, onMount, Show, Switch } from 'solid-js';
import { CampaignList, type CampaignRow } from '../components/campaign-list';
import {
  ContactList,
  type ContactRow,
  UnsubscribedList,
} from '../components/contact-list';
import { DeliveryPanel } from '../components/delivery-panel';
import { EnrollmentDialog } from '../components/enrollment-dialog';
import { errorMessage } from '../components/error-message';
import {
  ContactDialog,
  NewCampaignDialog,
  PreviewDialog,
  type Template,
  templateSteps,
} from '../components/marketing-dialogs';
import {
  MarketingSidebar,
  SECTIONS,
  type Section,
  sectionLabel,
} from '../components/marketing-sidebar';
import { SectionHeader } from '../components/section-header';
import type { MarketingCapabilities } from '../context/contracts';
import {
  type Campaign,
  type Enrollment,
  isReplaceable,
  isUnsubscribed,
  type MarketingContact,
  normalizeEmail,
} from '../core/model';
import { createMarketingWorkspace } from '../primitives/workspace';
import { CampaignDetail, type DetailTab } from './campaign-detail';

const SURFACE = 'email-marketing';
type StatusFilter = 'all' | Campaign['status'];
/** Edits to an open campaign and the stored copy they started from. */
type Edit = { base: Campaign; draft: Campaign };

export function MarketingWorkspaceView(props: {
  capabilities: MarketingCapabilities;
}) {
  const workspace = createMarketingWorkspace(props.capabilities);
  const panel = useSplitPanel();
  const [section, setSection] = createSignal<Section>('campaigns');
  const [openId, setOpenId] = createSignal<string>();
  const [edit, setEdit] = createSignal<Edit>();
  const [tab, setTab] = createSignal<DetailTab>('sequence');
  const [search, setSearch] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<StatusFilter>('all');
  const [creating, setCreating] = createSignal(false);
  const [enrolling, setEnrolling] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [preview, setPreview] = createSignal<number>();
  const [contact, setContact] = createSignal<MarketingContact>();
  const [unsubscribing, setUnsubscribing] = createSignal<MarketingContact>();
  let focusSearch: (() => void) | undefined;
  onMount(() => fireAndForget(workspace.initialize(), SURFACE));
  if (panel)
    useViewControlHotkeys({
      scopeId: panel.splitHotkeyScope,
      enabled: panel.isPanelActive,
      search: {
        description: t('emailMarketing.searchCampaigns'),
        condition: () =>
          !openId() && (section() === 'campaigns' || section() === 'contacts'),
        run: () => focusSearch?.(),
      },
    });

  // Dialogs here have no trigger to return focus to, so remember the opener.
  let opener: HTMLElement | undefined;
  const rememberOpener = () => {
    opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
  };
  const returnFocus = (event: Event) => {
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus();
  };
  const opening =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      rememberOpener();
      set(value);
    };

  const snapshot = workspace.snapshot;
  const stored = () =>
    snapshot().campaigns.find((campaign) => campaign.id === openId());
  /** The open campaign as shown: local edits over the stored copy. */
  const shown = () => edit()?.draft ?? stored();
  const changed = () => {
    const current = edit();
    return !!current && !deepEqual(current.draft, current.base);
  };
  const conflict = () => changed() && !deepEqual(stored(), edit()?.base);
  const change = (draft: Campaign) =>
    setEdit((current) => ({ base: current?.base ?? stored() ?? draft, draft }));
  const close = () => {
    setEdit(undefined);
    setOpenId(undefined);
  };

  /** Run a workspace action and confirm it with a toast. */
  async function act(
    name: string,
    action: () => Promise<void>,
    success: () => string,
    attributes?: Record<string, string | number>
  ) {
    const ok = await workspace.run(name, action, attributes);
    if (ok) toast.success(success());
    return ok;
  }

  const enrollmentsOf = (email: string) =>
    snapshot().enrollments.filter(
      (entry) => normalizeEmail(entry.contact.email) === normalizeEmail(email)
    );
  const campaignRows = (): CampaignRow[] =>
    snapshot()
      .campaigns.filter(
        (campaign) =>
          `${campaign.name} ${campaign.description}`
            .toLowerCase()
            .includes(search().toLowerCase()) &&
          (statusFilter() === 'all' || statusFilter() === campaign.status)
      )
      .map((campaign) => ({
        campaign,
        enrolled: snapshot().enrollments.filter(
          (entry) => entry.campaignId === campaign.id
        ).length,
        attention: workspace.campaignAttention(campaign.id),
      }));
  const attentionTotal = () =>
    snapshot().campaigns.reduce(
      (total, campaign) => total + workspace.campaignAttention(campaign.id),
      0
    );
  const contactRows = (): ContactRow[] =>
    workspace
      .contacts()
      .filter((item) =>
        `${item.name} ${item.email}`
          .toLowerCase()
          .includes(search().toLowerCase())
      )
      .map((item) => ({
        contact: item,
        sequences: enrollmentsOf(item.email).length,
        unsubscribed: isUnsubscribed(snapshot(), item.email),
      }));
  /** Live enrollments whose campaign record is gone (deleted in the database). */
  const orphans = () =>
    snapshot().enrollments.filter(
      (entry) =>
        entry.status !== 'stopped' &&
        !snapshot().campaigns.some((item) => item.id === entry.campaignId)
    ).length;
  const untrackedCount = () =>
    Object.values(workspace.untracked()).reduce(
      (total, ids) => total + ids.length,
      0
    );

  /** Leave the open campaign, saving unsaved edits first. */
  async function leaveCampaign() {
    const current = edit();
    if (current && changed() && current.draft.status !== 'active') {
      const ok = await act(
        'campaign.save',
        () => workspace.save(current.draft, false, current.base),
        () => t('emailMarketing.noticeSaved'),
        { campaign_id: current.draft.id }
      );
      if (!ok) return false;
    }
    close();
    return true;
  }
  async function go(next: Section) {
    if (!(await leaveCampaign())) return;
    setSection(next);
    setSearch('');
  }
  function openCampaign(campaign: Campaign) {
    setEdit(undefined);
    setOpenId(campaign.id);
    setTab('sequence');
  }
  function openCreate() {
    workspace.dismissError();
    rememberOpener();
    setCreating(true);
  }
  async function create(name: string, template: Template) {
    const campaign: Campaign = {
      id: crypto.randomUUID(),
      name,
      description: '',
      senderId: workspace.senders().find((sender) => sender.ready)?.id ?? '',
      status: 'draft',
      updatedAt: new Date().toISOString(),
      steps: templateSteps(template),
      optOutLine: t('emailMarketing.defaultOptOutLine'),
    };
    const ok = await act(
      'campaign.create',
      () => workspace.save(campaign, false, undefined),
      () => t('emailMarketing.noticeCreated'),
      { campaign_id: campaign.id, steps: campaign.steps.length }
    );
    if (!ok) return;
    setCreating(false);
    setSection('campaigns');
    openCampaign(campaign);
  }
  async function save(activate: boolean) {
    const campaign = shown();
    if (!campaign) return;
    const base = edit()?.base ?? stored();
    const ok = await act(
      activate ? 'campaign.activate' : 'campaign.save',
      () => workspace.save(campaign, activate, base),
      () =>
        activate
          ? t('emailMarketing.noticeActivated')
          : t('emailMarketing.noticeSaved'),
      { campaign_id: campaign.id, steps: campaign.steps.length }
    );
    if (ok) setEdit(undefined);
  }
  async function pause() {
    const campaign = stored();
    if (!campaign) return;
    await act(
      'campaign.pause',
      () => workspace.engine.pauseCampaign(campaign),
      () => t('emailMarketing.noticePaused'),
      { campaign_id: campaign.id }
    );
  }
  async function remove() {
    const campaign = stored();
    if (!campaign) return;
    const ok = await act(
      'campaign.delete',
      () => workspace.engine.deleteCampaign(campaign),
      () => t('emailMarketing.noticeDeleted', { name: campaign.name }),
      { campaign_id: campaign.id }
    );
    setDeleting(false);
    if (ok) close();
  }
  function stop(entry: Enrollment, status: 'paused' | 'stopped') {
    fireAndForget(
      act(
        `enrollment.${status === 'paused' ? 'pause' : 'stop'}`,
        () => workspace.engine.stop(entry, status),
        () =>
          status === 'paused'
            ? t('emailMarketing.noticeEnrollmentPaused')
            : t('emailMarketing.noticeEnrollmentStopped'),
        { campaign_id: entry.campaignId, enrollment_id: entry.id }
      ),
      SURFACE
    );
  }
  function resume(entry: Enrollment) {
    fireAndForget(
      act(
        'enrollment.resume',
        async () => {
          await workspace.engine.resume(entry);
        },
        () => t('emailMarketing.noticeResumed'),
        { campaign_id: entry.campaignId, enrollment_id: entry.id }
      ),
      SURFACE
    );
  }
  async function unsubscribe() {
    const person = unsubscribing();
    if (!person) return;
    await act(
      'unsubscribe',
      () => workspace.engine.unsubscribe(person.email),
      () => t('emailMarketing.noticeUnsubscribed', { email: person.email })
    );
    setUnsubscribing(undefined);
  }
  function stopOrphans() {
    fireAndForget(
      act(
        'enrollment.stop_orphans',
        () => workspace.engine.stopOrphans(),
        () => t('emailMarketing.noticeOrphansStopped'),
        { enrollments: orphans() }
      ),
      SURFACE
    );
  }
  function cancelUntracked() {
    const bySender = Object.entries(workspace.untracked());
    fireAndForget(
      act(
        'untracked.cancel',
        async () => {
          for (const [senderId, draftIds] of bySender)
            await workspace.engine.cancelUntracked(senderId, draftIds);
        },
        () => t('emailMarketing.noticeUntrackedCanceled'),
        { emails: untrackedCount() }
      ),
      SURFACE
    );
  }

  /** Problems that apply wherever the user is; below the header, never above it. */
  const banners = (): JSX.Element => (
    <div class="flex flex-col gap-2 px-4 empty:hidden">
      <Show when={workspace.error()}>
        {(cause) => (
          <div
            class="flex items-start justify-between gap-3 rounded-lg border border-failure/20 bg-failure/5 px-4 py-3 text-sm text-ink"
            role="alert"
          >
            <span class="whitespace-pre-line">{errorMessage(cause())}</span>
            <Button
              type="button"
              variant="link"
              size="xs"
              disabled={workspace.busy()}
              onClick={() => fireAndForget(workspace.initialize(), SURFACE)}
            >
              {t('emailMarketing.refresh')}
            </Button>
          </div>
        )}
      </Show>
      <Show when={snapshot().unreadable}>
        {(count) => (
          <p class="rounded-lg bg-warning/10 px-4 py-2 text-xs text-ink">
            {t('emailMarketing.unreadableNotice', { count: count() })}
          </p>
        )}
      </Show>
      <Show when={untrackedCount()}>
        {(count) => (
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-failure/5 px-4 py-2 text-xs text-ink">
            {t('emailMarketing.untrackedNotice', { count: count() })}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={workspace.busy()}
              onClick={cancelUntracked}
            >
              {t('emailMarketing.cancelUntracked')}
            </Button>
          </div>
        )}
      </Show>
      <Show when={orphans()}>
        {(count) => (
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-failure/5 px-4 py-2 text-xs text-ink">
            {t('emailMarketing.orphansNotice', { count: count() })}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={workspace.busy() || !snapshot().writable}
              onClick={stopOrphans}
            >
              {t('emailMarketing.stopOrphans')}
            </Button>
          </div>
        )}
      </Show>
    </div>
  );
  const touchNavigation = (): JSX.Element => (
    <Show when={isTouchDevice()}>
      <Tabs<Section>
        aria-label={t('emailMarketing.navigation')}
        iconOnly
        value={section()}
        disabled={workspace.busy()}
        onChange={(next) => fireAndForget(go(next), SURFACE)}
        options={SECTIONS.map((item) => ({
          value: item.id,
          label: sectionLabel(item.id),
          icon: item.icon,
        }))}
      />
    </Show>
  );
  const header = (title?: JSX.Element, actions?: JSX.Element) => (
    <SectionHeader
      touchNavigation={touchNavigation()}
      title={
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <h2 class="truncate text-sm font-semibold">
            {sectionLabel(section())}
          </h2>
          {title}
        </div>
      }
      actions={actions}
    />
  );
  const searchControl = (label: string) => (
    <ListHeaderSearch
      label={label}
      value={search()}
      onValueChange={setSearch}
      registerFocus={(focus) => {
        focusSearch = focus;
      }}
    />
  );
  const body = (children: JSX.Element) => (
    <>
      {banners()}
      <div class="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );

  return (
    <ViewShell.Root
      asidePreferenceKey="email-marketing"
      class="bg-page text-ink"
    >
      <Show when={!isTouchDevice()}>
        <ViewShell.Aside>
          <MarketingSidebar
            section={section()}
            counts={{
              campaigns: snapshot().campaigns.length,
              unsubscribed: snapshot().unsubscribed.length,
            }}
            attention={attentionTotal()}
            canCreate={snapshot().writable}
            disabled={workspace.busy()}
            onSelect={(next) => fireAndForget(go(next), SURFACE)}
            onCreate={openCreate}
          />
        </ViewShell.Aside>
      </Show>
      <ViewShell.Main aria-label={t('nav.emailMarketing')}>
        <Switch>
          <Match when={workspace.loading()}>
            {header()}
            <ListSkeleton.Root label={t('emailMarketing.loading')} class="px-4">
              <ListSkeleton.Row>
                <ListSkeleton.Bar class="h-4 w-1/2" />
              </ListSkeleton.Row>
              <ListSkeleton.Row>
                <ListSkeleton.Bar class="h-4 w-2/3" />
              </ListSkeleton.Row>
              <ListSkeleton.Row>
                <ListSkeleton.Bar class="h-4 w-2/5" />
              </ListSkeleton.Row>
            </ListSkeleton.Root>
          </Match>
          <Match when={!workspace.loaded()}>
            {/* No records yet: an error must not look like an empty account. */}
            {header()}
            <EmptyStatePanel
              centered
              title={t('emailMarketing.loadFailed')}
              description={errorMessage(workspace.error())}
              primaryAction={{
                label: t('emailMarketing.refresh'),
                onClick: () => fireAndForget(workspace.initialize(), SURFACE),
              }}
            />
          </Match>
          <Match when={section() === 'campaigns' && shown()}>
            {(campaign) => (
              <CampaignDetail
                workspace={workspace}
                campaign={campaign()}
                changed={changed()}
                conflict={conflict()}
                tab={tab()}
                touchNavigation={touchNavigation()}
                banners={banners()}
                onTab={setTab}
                onChange={change}
                onDiscard={() => setEdit(undefined)}
                onBack={() => fireAndForget(go('campaigns'), SURFACE)}
                onSave={(activate) => fireAndForget(save(activate), SURFACE)}
                onPause={() => fireAndForget(pause(), SURFACE)}
                onEnroll={() => {
                  rememberOpener();
                  setEnrolling(true);
                }}
                onDelete={() => {
                  rememberOpener();
                  setDeleting(true);
                }}
                onPreview={opening(setPreview)}
                onStop={stop}
                onResume={resume}
                onUnsubscribe={opening(setUnsubscribing)}
                onOpenContact={opening(setContact)}
                onOpenThread={props.capabilities.openThread}
              />
            )}
          </Match>
          <Match when={section() === 'campaigns'}>
            {header(
              <Tabs<StatusFilter>
                aria-label={t('emailMarketing.filterStatus')}
                value={statusFilter()}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: t('emailMarketing.filterAll') },
                  {
                    value: 'active',
                    label: t('emailMarketing.statusActive'),
                  },
                  { value: 'draft', label: t('emailMarketing.statusDraft') },
                  { value: 'paused', label: t('emailMarketing.statusPaused') },
                ]}
              />,
              <>
                <ViewCreateButton
                  aria-label={t('emailMarketing.newCampaign')}
                  disabled={!snapshot().writable || workspace.busy()}
                  onClick={openCreate}
                />
                {searchControl(t('emailMarketing.searchCampaigns'))}
              </>
            )}
            {body(
              <CampaignList
                rows={campaignRows()}
                filtered={!!search() || statusFilter() !== 'all'}
                canCreate={snapshot().writable && !workspace.busy()}
                onCreate={openCreate}
                onOpen={openCampaign}
              />
            )}
          </Match>
          <Match when={section() === 'contacts'}>
            {header(
              undefined,
              searchControl(t('emailMarketing.searchContacts'))
            )}
            {body(
              <ContactList
                rows={contactRows()}
                filtered={!!search()}
                onOpen={opening(setContact)}
              />
            )}
          </Match>
          <Match when={section() === 'unsubscribed'}>
            {header()}
            {body(<UnsubscribedList entries={snapshot().unsubscribed} />)}
          </Match>
          <Match when={section() === 'delivery'}>
            {header(
              undefined,
              <Show when={snapshot().databaseId}>
                {(id) => (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => props.capabilities.openDatabase(id())}
                  >
                    {t('emailMarketing.openDatabase')}
                  </Button>
                )}
              </Show>
            )}
            {body(<DeliveryPanel senders={workspace.senders()} />)}
          </Match>
        </Switch>
      </ViewShell.Main>
      {/* Mounted per opening, so every new campaign starts blank. */}
      <Show when={creating()}>
        <NewCampaignDialog
          open
          busy={workspace.busy()}
          error={workspace.error()}
          onOpenChange={setCreating}
          onCloseAutoFocus={returnFocus}
          onCreate={(name, template) =>
            fireAndForget(create(name, template), SURFACE)
          }
        />
      </Show>
      <Show when={shown()}>
        {(campaign) => (
          <>
            <PreviewDialog
              campaign={campaign()}
              stepIndex={preview()}
              contacts={workspace.contacts()}
              onClose={() => setPreview(undefined)}
              onCloseAutoFocus={returnFocus}
            />
            <Show when={enrolling()}>
              <EnrollmentDialog
                campaign={campaign()}
                contacts={workspace.contacts()}
                // A failed enrollment with nothing sent can be retried in place.
                enrolledEmails={snapshot()
                  .enrollments.filter(
                    (entry) =>
                      entry.campaignId === campaign().id &&
                      !isReplaceable(entry)
                  )
                  .map((entry) => normalizeEmail(entry.contact.email))}
                isUnsubscribed={(email) => isUnsubscribed(snapshot(), email)}
                busy={workspace.busy()}
                error={workspace.error()}
                onClose={() => setEnrolling(false)}
                onCloseAutoFocus={returnFocus}
                onSearchCrm={props.capabilities.searchCrmContacts}
                onEnroll={(people, startAt) =>
                  act(
                    'enroll',
                    () => workspace.enroll(campaign(), people, startAt),
                    () =>
                      t('emailMarketing.noticeEnrolled', {
                        count: people.length,
                      }),
                    {
                      campaign_id: campaign().id,
                      contacts: people.length,
                      steps: campaign().steps.length,
                    }
                  )
                }
              />
            </Show>
            <DeleteDialog
              open={deleting()}
              onOpenChange={setDeleting}
              onCloseAutoFocus={returnFocus}
              pending={workspace.busy()}
              title={t('emailMarketing.deleteTitle', {
                name: campaign().name,
              })}
              body={t('emailMarketing.deleteBody')}
              deleteLabel={t('emailMarketing.delete')}
              cancelLabel={t('emailMarketing.cancel')}
              onDelete={() => fireAndForget(remove(), SURFACE)}
            />
          </>
        )}
      </Show>
      <ContactDialog
        contact={contact()}
        entries={enrollmentsOf(contact()?.email ?? '')}
        unsubscribed={
          !!contact() && isUnsubscribed(snapshot(), contact()!.email)
        }
        disabled={workspace.busy() || !snapshot().writable}
        attention={workspace.enrollmentAttention}
        onClose={() => setContact(undefined)}
        onCloseAutoFocus={returnFocus}
        onOpenCrm={props.capabilities.openContact}
        onUnsubscribe={setUnsubscribing}
      />
      <ConfirmDialog
        open={!!unsubscribing()}
        onOpenChange={(open) => {
          if (!open) setUnsubscribing(undefined);
        }}
        onCloseAutoFocus={returnFocus}
        pending={workspace.busy()}
        tone="danger"
        title={t('emailMarketing.unsubscribeTitle', {
          email: unsubscribing()?.email ?? '',
        })}
        body={t('emailMarketing.unsubscribeBody')}
        confirmLabel={t('emailMarketing.markUnsubscribed')}
        cancelLabel={t('emailMarketing.cancel')}
        onConfirm={() => fireAndForget(unsubscribe(), SURFACE)}
      />
    </ViewShell.Root>
  );
}

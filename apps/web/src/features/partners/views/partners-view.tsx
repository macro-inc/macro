import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { SidebarCreateHeader } from '@app/components/view-shell/SidebarCreateButton';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { formatLocale, t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useEmail } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, ButtonGroup, cn, Dialog, Panel, Tabs, TextField } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  Show,
} from 'solid-js';
import {
  acceptedPartnerForEmail,
  inGoodStanding,
  isMacroStaff,
  type Partner,
  type PartnerStatus,
  type Payout,
  type PayoutNote,
  type PayoutStatus,
  type PortalError,
  type TaxForm,
} from '../core/portal';
import {
  addAcceptedPartner,
  addReferral,
  payoutsFor,
  portalData,
  referralsFor,
  restoreSamplePartners,
  setDirectory,
  setPartnerStatus,
  setPaymentDetails,
  setTaxForm,
  setTeamSeat,
} from '../primitives/store';
import { PipelineBoard, ReferralList } from './pipeline-board';

type AdminTab = 'overview' | 'referrals' | 'payouts';
type PartnerTab = 'referrals' | 'payouts' | 'program';
type PortalMode = 'admin' | 'preview' | 'self';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(formatLocale(), {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function partnerStatusLabel(status: PartnerStatus): string {
  if (status === 'applied') return t('partners.statusApplied');
  if (status === 'accepted') return t('partners.statusAccepted');
  return t('partners.statusSuspended');
}

function payoutStatusLabel(status: PayoutStatus): string {
  if (status === 'scheduled') return t('partners.statusScheduled');
  if (status === 'paid') return t('partners.statusPaid');
  if (status === 'withheld') return t('partners.statusWithheld');
  return t('partners.statusRolled');
}

function payoutNote(note: PayoutNote): string {
  if (note === 'withheldTax') return t('partners.noteWithheldTax');
  if (note === 'rolled') return t('partners.noteRolled');
  return t('partners.notePreview');
}

function partnerError(error: 'invalid' | 'duplicate'): string {
  if (error === 'duplicate') return t('partners.duplicatePartner');
  return t('partners.invalidEmail');
}

function referralError(error: PortalError): string {
  if (error === 'duplicate') return t('partners.duplicateEmail');
  if (error === 'unavailable') return t('partners.suspendedNotice');
  return t('partners.invalidEmail');
}

function RecordDialog(props: {
  open: boolean;
  title: string;
  help: string;
  submitLabel: string;
  error: string | undefined;
  showOrganization?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    name: string;
    email: string;
    organization: string;
  }) => void;
}) {
  const formId = createUniqueId();
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [organization, setOrganization] = createSignal('');

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setName('');
        setEmail('');
        setOrganization('');
      }
    )
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      position="center"
      class="w-105"
    >
      <Panel depth={2} active class="rounded-xl text-ink">
        <Panel.Header class="px-5">
          <Dialog.Title class="text-sm font-semibold">
            {props.title}
          </Dialog.Title>
          <div class="ml-auto">
            <Button
              tooltip={t('partners.close')}
              variant="ghost"
              size="icon-sm"
              aria-label={t('partners.close')}
              onClick={() => props.onOpenChange(false)}
            >
              <XIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
          </div>
        </Panel.Header>
        <Panel.Body class="p-5">
          <form
            id={formId}
            class="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit({
                name: name(),
                email: email(),
                organization: organization(),
              });
            }}
          >
            <p class="text-sm text-ink-muted">{props.help}</p>
            <TextField value={name()} onChange={setName}>
              <TextField.Label>{t('partners.fieldName')}</TextField.Label>
              <TextField.Input required autocomplete="off" />
            </TextField>
            <TextField value={email()} onChange={setEmail}>
              <TextField.Label>{t('partners.fieldEmail')}</TextField.Label>
              <TextField.Input type="email" required autocomplete="off" />
            </TextField>
            <Show when={props.showOrganization !== false}>
              <TextField value={organization()} onChange={setOrganization}>
                <TextField.Label>
                  {t('partners.fieldOrganization')}
                </TextField.Label>
                <TextField.Input autocomplete="off" />
                <TextField.Description>
                  {t('partners.organizationOptional')}
                </TextField.Description>
              </TextField>
            </Show>
            <Show when={props.error}>
              <p role="alert" class="text-xs text-failure">
                {props.error}
              </p>
            </Show>
          </form>
        </Panel.Body>
        <Panel.Footer class="justify-end gap-2 px-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => props.onOpenChange(false)}
          >
            {t('partners.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="secondary" size="sm">
            {props.submitLabel}
          </Button>
        </Panel.Footer>
      </Panel>
    </Dialog>
  );
}

function PartnerList(props: {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const partners = () => portalData().partners;
  return (
    <ViewSidebar.Root aria-label={t('partners.partnerList')}>
      <SidebarCreateHeader
        title={t('nav.partners')}
        label={t('partners.addPartner')}
        onCreate={props.onAdd}
      />
      <ViewSidebar.Content>
        <Show
          when={partners().length > 0}
          fallback={
            <p class="px-2 py-3 text-sm text-ink-muted">
              {t('partners.emptyPartners')}
            </p>
          }
        >
          <ul class="flex flex-col gap-0.5">
            <For each={partners()}>
              {(partner) => {
                const count = () => referralsFor(partner.id).length;
                const selected = () => props.selectedId === partner.id;
                return (
                  <li>
                    <button
                      type="button"
                      class={cn(
                        'flex w-full flex-col gap-0.5 rounded-lg px-2 py-2 text-left hover:bg-active',
                        selected() && 'bg-active'
                      )}
                      aria-current={selected() ? 'true' : undefined}
                      onClick={() => props.onSelect(partner.id)}
                    >
                      <span class="truncate text-sm font-medium text-ink">
                        {partner.name}
                      </span>
                      <span class="truncate text-xs text-ink-muted">
                        {partner.organization || partner.email}
                        {' · '}
                        {partnerStatusLabel(partner.status)}
                        {' · '}
                        {t('partners.referralCount', { count: count() })}
                      </span>
                      <span class="truncate text-xs text-ink-muted">
                        {partner.seat
                          ? t('partners.seatLineFilled', {
                              name: partner.seat.name,
                            })
                          : t('partners.seatLineOpen')}
                      </span>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </ViewSidebar.Content>
      <ViewSidebar.Footer class="flex flex-col items-start gap-2">
        <p class="text-xs text-ink-muted">{t('partners.localNotice')}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => restoreSamplePartners()}
        >
          {t('partners.restoreSample')}
        </Button>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}

function PartnerTable(props: { onSelect: (id: string) => void }) {
  const partners = () => portalData().partners;
  const columns =
    'grid-cols-[minmax(9rem,1.2fr)_minmax(8rem,1fr)_minmax(11rem,1.3fr)_minmax(6.5rem,0.7fr)_minmax(6rem,0.6fr)_minmax(8rem,1fr)]';
  const headers = [
    t('partners.fieldName'),
    t('partners.columnCompany'),
    t('partners.fieldEmail'),
    t('partners.columnStatus'),
    t('partners.tabReferrals'),
    t('partners.secondSeat'),
  ];
  return (
    <div class="overflow-x-auto">
      <div
        role="table"
        aria-label={t('partners.partnerList')}
        class={`grid border-b border-edge-muted text-sm ${columns}`}
      >
        <div
          role="row"
          class={`sticky top-0 z-1 col-span-full grid grid-cols-subgrid min-h-10 border-b border-edge-muted bg-panel text-xs text-ink-muted`}
        >
          <For each={headers}>
            {(header) => (
              <div role="columnheader" class="flex items-center truncate px-3">
                {header}
              </div>
            )}
          </For>
        </div>
        <For each={partners()}>
          {(partner) => (
            <button
              type="button"
              class="col-span-full grid min-h-10 grid-cols-subgrid border-b border-edge-muted/60 text-left hover:bg-hover/50"
              onClick={() => props.onSelect(partner.id)}
            >
              <span class="flex items-center truncate px-3 font-medium text-ink">
                {partner.name}
              </span>
              <span class="flex items-center truncate px-3 text-ink">
                {partner.organization || '—'}
              </span>
              <span class="flex items-center truncate px-3 text-ink-muted">
                {partner.email}
              </span>
              <span class="flex items-center truncate px-3 text-ink">
                {partnerStatusLabel(partner.status)}
              </span>
              <span class="flex items-center truncate px-3 text-ink">
                {t('partners.referralCount', {
                  count: referralsFor(partner.id).length,
                })}
              </span>
              <span class="flex items-center truncate px-3 text-ink">
                {partner.seat?.name ?? t('partners.seatLineOpen')}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

function PayoutList(props: { partnerId: string }) {
  const payouts = () => payoutsFor(props.partnerId);
  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-ink-muted">{t('partners.previewNotice')}</p>
      <Show
        when={payouts().length > 0}
        fallback={
          <p class="text-sm text-ink-muted">{t('partners.emptyPayouts')}</p>
        }
      >
        <ul class="flex flex-col gap-3">
          <For each={payouts()}>
            {(payout: Payout) => (
              <li class="flex flex-col gap-0.5 rounded-lg border border-edge-muted px-3 py-3">
                <span class="text-sm font-medium text-ink">
                  {t('partners.quarter', {
                    year: String(payout.year),
                    quarter: payout.quarter,
                  })}
                </span>
                <span class="text-sm text-ink">
                  {formatMoney(payout.amountCents)}
                  {' · '}
                  {payoutStatusLabel(payout.status)}
                </span>
                <span class="text-xs text-ink-muted">
                  {payoutNote(payout.note)}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

function Standing(props: { partner: Partner }) {
  const standing = () => inGoodStanding(props.partner);
  return (
    <div class="flex flex-col gap-1">
      <p class="text-sm font-medium text-ink">
        {standing()
          ? t('partners.goodStanding')
          : t('partners.notGoodStanding')}
      </p>
      <Show when={!standing()}>
        <p class="text-xs text-ink-muted">{t('partners.standingNeeds')}</p>
      </Show>
      <p class="text-sm text-ink">
        {props.partner.taxForm === 'missing'
          ? t('partners.taxNotOnFile')
          : t('partners.taxOnFile')}
        {' · '}
        {props.partner.paymentDetails
          ? t('partners.paymentOnFile')
          : t('partners.paymentMissing')}
      </p>
      <p class="text-sm text-ink">
        {props.partner.directory
          ? t('partners.directoryListed')
          : t('partners.directoryHidden')}
      </p>
    </div>
  );
}

function seatError(error: 'invalid' | 'self' | 'unavailable'): string {
  if (error === 'self') return t('partners.seatSelf');
  if (error === 'unavailable') return t('partners.seatNeedsAcceptance');
  return t('partners.invalidEmail');
}

function SecondSeat(props: { partner: Partner }) {
  const [open, setOpen] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const seat = () => props.partner.seat;
  const canEdit = () => props.partner.status === 'accepted';

  return (
    <div class="flex flex-col gap-2 rounded-lg border border-edge-muted px-3 py-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <p class="text-sm font-medium text-ink">{t('partners.secondSeat')}</p>
          <p class="text-xs text-ink-muted">{t('partners.secondSeatHelp')}</p>
        </div>
        <Show when={canEdit()}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(undefined);
              setOpen(true);
            }}
          >
            {seat() ? t('partners.changeSeat') : t('partners.addSeat')}
          </Button>
        </Show>
      </div>
      <Show
        when={seat()}
        fallback={
          <p class="text-sm text-ink-muted">{t('partners.seatOpen')}</p>
        }
      >
        {(current) => (
          <div class="flex flex-col gap-0.5">
            <p class="text-sm text-ink">{current().name}</p>
            <p class="text-xs text-ink-muted">{current().email}</p>
            <p class="text-xs text-ink-muted">{t('partners.seatFree')}</p>
          </div>
        )}
      </Show>
      <Show when={!canEdit()}>
        <p class="text-xs text-ink-muted">
          {t('partners.seatNeedsAcceptance')}
        </p>
      </Show>
      <Show when={canEdit() && seat()}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTeamSeat(props.partner.id, null)}
        >
          {t('partners.removeSeat')}
        </Button>
      </Show>
      <RecordDialog
        open={open()}
        title={t('partners.newSeat')}
        help={t('partners.newSeatHelp')}
        submitLabel={t('partners.saveSeat')}
        error={error()}
        showOrganization={false}
        onOpenChange={setOpen}
        onSubmit={(input) => {
          const result = setTeamSeat(props.partner.id, input);
          if (!result.ok) {
            setError(seatError(result.error));
            return;
          }
          setOpen(false);
        }}
      />
    </div>
  );
}

function AdminDetail(props: {
  partner: Partner;
  tab: AdminTab;
  onTab: (tab: AdminTab) => void;
  onPreview: () => void;
}) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h1 class="truncate text-sm font-semibold text-ink">
            {props.partner.name}
          </h1>
          <p class="truncate text-xs text-ink-muted">
            {props.partner.email}
            <Show when={props.partner.organization}>
              {' · '}
              {props.partner.organization}
            </Show>
            {' · '}
            {partnerStatusLabel(props.partner.status)}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Show when={props.partner.status === 'applied'}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setPartnerStatus(props.partner.id, 'accepted')}
            >
              {t('partners.accept')}
            </Button>
          </Show>
          <Show when={props.partner.status === 'accepted'}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPartnerStatus(props.partner.id, 'suspended')}
            >
              {t('partners.suspend')}
            </Button>
          </Show>
          <Show when={props.partner.status === 'suspended'}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setPartnerStatus(props.partner.id, 'accepted')}
            >
              {t('partners.restore')}
            </Button>
          </Show>
          <HeaderActionGroup label={t('partners.viewAsPartner')}>
            <ButtonGroup.Button variant="ghost" onClick={props.onPreview}>
              {t('partners.viewAsPartner')}
            </ButtonGroup.Button>
          </HeaderActionGroup>
        </div>
      </div>
      <Tabs
        aria-label={t('partners.sections')}
        size="md"
        value={props.tab}
        onChange={props.onTab}
        options={[
          { value: 'overview', label: t('partners.tabOverview') },
          { value: 'referrals', label: t('partners.tabReferrals') },
          { value: 'payouts', label: t('partners.tabPayouts') },
        ]}
      />
      <Show when={props.tab === 'overview'}>
        <div class="flex flex-col gap-4">
          <SecondSeat partner={props.partner} />
          <Standing partner={props.partner} />
          <div class="flex flex-col gap-2">
            <p class="text-xs font-medium text-ink">
              {t('partners.taxFormLabel')}
            </p>
            <Tabs
              aria-label={t('partners.taxFormLabel')}
              size="sm"
              value={props.partner.taxForm}
              onChange={(taxForm: TaxForm) =>
                setTaxForm(props.partner.id, taxForm)
              }
              options={[
                { value: 'missing', label: t('partners.missing') },
                { value: 'w9', label: t('partners.taxW9') },
                { value: 'w8', label: t('partners.taxW8') },
              ]}
            />
          </div>
          <div class="flex flex-col gap-2">
            <p class="text-xs font-medium text-ink">
              {t('partners.paymentLabel')}
            </p>
            <Tabs
              aria-label={t('partners.paymentLabel')}
              size="sm"
              value={props.partner.paymentDetails ? 'yes' : 'no'}
              onChange={(value: 'yes' | 'no') =>
                setPaymentDetails(props.partner.id, value === 'yes')
              }
              options={[
                { value: 'yes', label: t('partners.onFile') },
                { value: 'no', label: t('partners.missing') },
              ]}
            />
          </div>
          <div class="flex flex-col gap-2">
            <p class="text-xs font-medium text-ink">
              {t('partners.directoryLabel')}
            </p>
            <Tabs
              aria-label={t('partners.directoryLabel')}
              size="sm"
              value={props.partner.directory ? 'listed' : 'hidden'}
              onChange={(value: 'listed' | 'hidden') =>
                setDirectory(props.partner.id, value === 'listed')
              }
              options={[
                { value: 'listed', label: t('partners.listed') },
                { value: 'hidden', label: t('partners.hidden') },
              ]}
            />
          </div>
        </div>
      </Show>
      <Show when={props.tab === 'referrals'}>
        <ReferralList partnerId={props.partner.id} />
      </Show>
      <Show when={props.tab === 'payouts'}>
        <PayoutList partnerId={props.partner.id} />
      </Show>
    </div>
  );
}

function PartnerPortal(props: {
  partner: Partner;
  tab: PartnerTab;
  onTab: (tab: PartnerTab) => void;
  onAdd: () => void;
}) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <h1 class="truncate text-sm font-semibold text-ink">
            {props.partner.organization || props.partner.name}
          </h1>
          <p class="text-xs text-ink-muted">
            <Show
              when={props.partner.status === 'accepted'}
              fallback={partnerStatusLabel(props.partner.status)}
            >
              {t('partners.official')}
            </Show>
          </p>
        </div>
        <Show
          when={
            props.tab === 'referrals' && props.partner.status === 'accepted'
          }
        >
          <ViewCreateButton
            presentation="toolbar"
            aria-label={t('partners.addReferral')}
            onClick={props.onAdd}
          />
        </Show>
      </div>
      <SecondSeat partner={props.partner} />
      <Tabs
        aria-label={t('partners.sections')}
        size="md"
        value={props.tab}
        onChange={props.onTab}
        options={[
          { value: 'referrals', label: t('partners.tabReferrals') },
          { value: 'payouts', label: t('partners.tabPayouts') },
          { value: 'program', label: t('partners.tabProgram') },
        ]}
      />
      <Show when={props.partner.status === 'suspended'}>
        <p class="text-sm text-ink-muted">{t('partners.suspendedNotice')}</p>
      </Show>
      <Show when={props.partner.status === 'applied'}>
        <p class="text-sm text-ink-muted">{t('partners.pendingNotice')}</p>
      </Show>
      <Show when={props.tab === 'referrals'}>
        <PipelineBoard partnerId={props.partner.id} />
      </Show>
      <Show when={props.tab === 'payouts'}>
        <PayoutList partnerId={props.partner.id} />
      </Show>
      <Show when={props.tab === 'program'}>
        <div class="flex flex-col gap-3 text-sm text-ink">
          <p>{t('partners.programFee')}</p>
          <p>{t('partners.programSchedule')}</p>
          <p>{t('partners.programNoFee')}</p>
          <p>{t('partners.programDirectory')}</p>
          <p>{t('partners.programData')}</p>
          <Standing partner={props.partner} />
          <p class="text-xs text-ink-muted">{t('partners.localNotice')}</p>
        </div>
      </Show>
    </div>
  );
}

export function PartnersView() {
  useSplitDisplayName(() => t('nav.partners'));
  const email = useEmail();
  const [selectedId, setSelectedId] = createSignal<string>();
  const [preview, setPreview] = createSignal(false);
  const [adminTab, setAdminTab] = createSignal<AdminTab>('referrals');
  const [partnerTab, setPartnerTab] = createSignal<PartnerTab>('referrals');
  const [partnerDialog, setPartnerDialog] = createSignal(false);
  const [referralDialog, setReferralDialog] = createSignal(false);
  const [partnerFormError, setPartnerFormError] = createSignal<string>();
  const [referralFormError, setReferralFormError] = createSignal<string>();

  const mode = createMemo((): PortalMode => {
    if (!isMacroStaff(email())) return 'self';
    if (preview()) return 'preview';
    return 'admin';
  });

  const selected = createMemo(() => {
    const id = selectedId();
    if (!id) return undefined;
    return portalData().partners.find((partner) => partner.id === id);
  });

  const detailPartner = createMemo(() => {
    if (mode() === 'self') {
      return acceptedPartnerForEmail(portalData(), email());
    }
    return selected();
  });

  const showList = () =>
    mode() === 'admin' && (isTouchDevice() ? !selected() : true);

  const choose = (id: string) => {
    setSelectedId(id);
    setPreview(false);
    setAdminTab('referrals');
    setPartnerTab('referrals');
  };

  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root asidePreferenceKey="partners" resizable>
          <Show when={!isTouchDevice() && mode() === 'admin'}>
            <ViewShell.Aside>
              <PartnerList
                selectedId={detailPartner()?.id}
                onSelect={choose}
                onAdd={() => {
                  setPartnerFormError(undefined);
                  setPartnerDialog(true);
                }}
              />
            </ViewShell.Aside>
          </Show>
          <ViewShell.Main>
            <div class="flex h-full min-h-0 flex-col">
              <Show when={isTouchDevice() && (preview() || !!selected())}>
                <div class="px-3 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (preview()) {
                        setPreview(false);
                        return;
                      }
                      setSelectedId(undefined);
                    }}
                  >
                    <CaretLeftIcon class="size-3.5 touch:size-6" />
                    {t('partners.back')}
                  </Button>
                </div>
              </Show>
              <Show
                when={mode() === 'admin' && !!selected() && !isTouchDevice()}
              >
                <div class="px-4 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedId(undefined)}
                  >
                    <CaretLeftIcon class="size-3.5" />
                    {t('partners.partnerList')}
                  </Button>
                </div>
              </Show>
              <Show when={mode() === 'preview'}>
                <div class="flex flex-wrap items-center gap-3 border-b border-edge-muted px-4 py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreview(false)}
                  >
                    <CaretLeftIcon class="size-3.5" />
                    {t('partners.backToAdmin')}
                  </Button>
                  <p class="text-sm text-ink-muted">
                    {t('partners.previewBanner')}
                  </p>
                </div>
              </Show>
              <Show
                when={showList() && isTouchDevice()}
                fallback={
                  <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <Show
                      when={detailPartner()}
                      fallback={
                        <Show
                          when={
                            mode() === 'admin' &&
                            portalData().partners.length > 0
                          }
                          fallback={
                            <p class="text-sm text-ink-muted">
                              {mode() === 'admin'
                                ? t('partners.emptyPartners')
                                : t('partners.emptySelection')}
                            </p>
                          }
                        >
                          <PartnerTable onSelect={choose} />
                        </Show>
                      }
                    >
                      {(partner) => (
                        <Show
                          when={mode() === 'admin'}
                          fallback={
                            <PartnerPortal
                              partner={partner()}
                              tab={partnerTab()}
                              onTab={setPartnerTab}
                              onAdd={() => {
                                setReferralFormError(undefined);
                                setReferralDialog(true);
                              }}
                            />
                          }
                        >
                          <AdminDetail
                            partner={partner()}
                            tab={adminTab()}
                            onTab={setAdminTab}
                            onPreview={() => {
                              setPreview(true);
                              setPartnerTab('referrals');
                            }}
                          />
                        </Show>
                      )}
                    </Show>
                  </div>
                }
              >
                <div class="min-h-0 flex-1">
                  <PartnerList
                    selectedId={undefined}
                    onSelect={choose}
                    onAdd={() => {
                      setPartnerFormError(undefined);
                      setPartnerDialog(true);
                    }}
                  />
                </div>
              </Show>
            </div>
          </ViewShell.Main>
        </ViewShell.Root>
      </SplitPanel.Body>
      <RecordDialog
        open={partnerDialog()}
        title={t('partners.newPartner')}
        help={t('partners.newPartnerHelp')}
        submitLabel={t('partners.savePartner')}
        error={partnerFormError()}
        onOpenChange={setPartnerDialog}
        onSubmit={(input) => {
          const result = addAcceptedPartner(input);
          if (!result.ok) {
            setPartnerFormError(partnerError(result.error));
            return;
          }
          setPartnerDialog(false);
          choose(result.id);
        }}
      />
      <RecordDialog
        open={referralDialog()}
        title={t('partners.newReferral')}
        help={t('partners.claimNotice')}
        submitLabel={t('partners.saveReferral')}
        error={referralFormError()}
        onOpenChange={setReferralDialog}
        onSubmit={(input) => {
          const partner = detailPartner();
          if (!partner) return;
          const result = addReferral(partner.id, input);
          if (!result.ok) {
            setReferralFormError(referralError(result.error));
            return;
          }
          setReferralDialog(false);
        }}
      />
    </SplitPanel.Root>
  );
}

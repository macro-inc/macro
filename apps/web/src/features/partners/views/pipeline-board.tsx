import { t } from '@app/lib/i18n';
import XIcon from '@icon/system/regular/x.svg';
import { Button, Dialog, Panel, Select, Tabs, TextField } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  columnsByStage,
  columnsByTeam,
  PIPELINE_STAGES,
  type PricingTier,
  type Referral,
  type ReferralStatus,
} from '../core/portal';
import {
  addCustomerTeam,
  referralsFor,
  setReferralPlacement,
  teamsFor,
} from '../primitives/store';

type Layout = 'pipeline' | 'team';
type Choice = { value: string; label: string };

const TIERS: readonly PricingTier[] = ['free', 'premium', 'max'];

function stageLabel(status: ReferralStatus): string {
  if (status === 'submitted') return t('partners.stageReferred');
  if (status === 'accepted') return t('partners.statusAccepted');
  if (status === 'paying') return t('partners.statusPaying');
  if (status === 'rejected') return t('partners.statusRejected');
  return t('partners.statusIneligible');
}

function tierLabel(tier: PricingTier): string {
  if (tier === 'premium') return t('partners.tierPro');
  if (tier === 'max') return t('partners.tierMax');
  return t('partners.tierFree');
}

function ChoiceSelect(props: {
  label: string;
  options: Choice[];
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = () =>
    props.options.find((option) => option.value === props.value) ??
    props.options[0];
  return (
    <Select<Choice>
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      gutter={4}
    >
      <Select.Label class="text-xs text-ink-muted">{props.label}</Select.Label>
      <Select.Trigger aria-label={props.label}>
        <Select.Value<Choice>>
          {(state) => state.selectedOption().label}
        </Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content portalScope="local">
        <Select.Listbox />
      </Select.Content>
    </Select>
  );
}

function EditReferral(props: {
  referral: Referral;
  partnerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = createSignal<ReferralStatus>(
    props.referral.status
  );
  const [teamId, setTeamId] = createSignal<string | null>(
    props.referral.teamId
  );
  const [tier, setTier] = createSignal<PricingTier>(props.referral.tier);
  const [teamName, setTeamName] = createSignal('');
  const [members, setMembers] = createSignal('1');
  const [teamError, setTeamError] = createSignal(false);

  const openWith = (open: boolean) => {
    if (open) {
      setStatus(props.referral.status);
      setTeamId(props.referral.teamId);
      setTier(props.referral.tier);
      setTeamName('');
      setMembers('1');
      setTeamError(false);
    }
    props.onOpenChange(open);
  };

  const teamOptions = (): Choice[] => [
    { value: '', label: t('partners.noTeam') },
    ...teamsFor(props.partnerId).map((team) => ({
      value: team.id,
      label: team.name,
    })),
  ];

  const addTeam = () => {
    const memberCount = Number(members());
    const created = addCustomerTeam(props.partnerId, {
      name: teamName(),
      memberCount,
    });
    if (!created.ok) {
      setTeamError(true);
      return;
    }
    setTeamError(false);
    setTeamId(created.id);
    setTeamName('');
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={openWith}
      position="center"
      class="w-105"
    >
      <Panel depth={2} active class="rounded-xl text-ink">
        <Panel.Header class="px-5">
          <Dialog.Title class="text-sm font-semibold">
            {props.referral.name}
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
            class="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setReferralPlacement(props.referral.id, {
                status: status(),
                teamId: teamId(),
                tier: tier(),
              });
              props.onOpenChange(false);
            }}
          >
            <ChoiceSelect
              label={t('partners.stageLabel')}
              options={PIPELINE_STAGES.map((stage) => ({
                value: stage,
                label: stageLabel(stage),
              }))}
              value={status()}
              onChange={(value) => setStatus(value as ReferralStatus)}
            />
            <ChoiceSelect
              label={t('partners.teamLabel')}
              options={teamOptions()}
              value={teamId() ?? ''}
              onChange={(value) => setTeamId(value || null)}
            />
            <ChoiceSelect
              label={t('partners.pricingTier')}
              options={TIERS.map((value) => ({
                value,
                label: tierLabel(value),
              }))}
              value={tier()}
              onChange={(value) => setTier(value as PricingTier)}
            />
            <div class="flex flex-col gap-2 rounded-lg border border-edge-muted px-3 py-3">
              <p class="text-sm font-medium text-ink">
                {t('partners.newTeam')}
              </p>
              <p class="text-xs text-ink-muted">{t('partners.newTeamHelp')}</p>
              <TextField value={teamName()} onChange={setTeamName}>
                <TextField.Label>{t('partners.teamName')}</TextField.Label>
                <TextField.Input autocomplete="off" />
              </TextField>
              <TextField value={members()} onChange={setMembers}>
                <TextField.Label>
                  {t('partners.memberCountLabel')}
                </TextField.Label>
                <TextField.Input inputMode="numeric" autocomplete="off" />
              </TextField>
              <Show when={teamError()}>
                <p role="alert" class="text-xs text-failure">
                  {t('partners.invalidTeam')}
                </p>
              </Show>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={addTeam}
              >
                {t('partners.saveTeam')}
              </Button>
            </div>
            <div class="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onOpenChange(false)}
              >
                {t('partners.cancel')}
              </Button>
              <Button type="submit" variant="primary" size="sm">
                {t('partners.savePlacement')}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}

function ReferralCard(props: { referral: Referral; partnerId: string }) {
  const [open, setOpen] = createSignal(false);
  const team = () =>
    teamsFor(props.partnerId).find(
      (item) => item.id === props.referral.teamId
    ) ?? null;
  return (
    <article class="flex flex-col gap-2 rounded-lg border border-edge-muted bg-surface px-3 py-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm font-medium text-ink">{props.referral.name}</span>
        <span class="truncate text-xs text-ink-muted">
          {props.referral.email}
        </span>
      </div>
      <p class="text-xs text-ink">{tierLabel(props.referral.tier)}</p>
      <Show
        when={team()}
        fallback={<p class="text-xs text-ink-muted">{t('partners.noTeam')}</p>}
      >
        {(current) => (
          <p class="text-xs text-ink">
            {t('partners.onTeamMembers', {
              name: props.referral.name,
              team: current().name,
              count: current().memberCount,
            })}
          </p>
        )}
      </Show>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t('partners.editPlacement')}
      </Button>
      <EditReferral
        referral={props.referral}
        partnerId={props.partnerId}
        open={open()}
        onOpenChange={setOpen}
      />
    </article>
  );
}

const REFERRAL_COLUMNS =
  'grid-cols-[minmax(9rem,1.3fr)_minmax(8rem,1.1fr)_minmax(11rem,1.4fr)_minmax(5rem,0.6fr)_minmax(6.5rem,0.7fr)_minmax(8rem,1fr)_minmax(5.5rem,0.6fr)]';

function ReferralCells(props: { referral: Referral; partnerId: string }) {
  const team = () =>
    teamsFor(props.partnerId).find(
      (item) => item.id === props.referral.teamId
    ) ?? null;
  return (
    <>
      <div
        role="cell"
        class="flex items-center truncate px-3 font-medium text-ink"
      >
        {props.referral.name}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink">
        {props.referral.organization || '—'}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink-muted">
        {props.referral.email}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink">
        {tierLabel(props.referral.tier)}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink">
        {stageLabel(props.referral.status)}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink">
        {team()?.name ?? t('partners.noTeam')}
      </div>
      <div role="cell" class="flex items-center truncate px-3 text-ink">
        <Show when={team()} fallback="—">
          {(current) =>
            t('partners.memberCount', { count: current().memberCount })
          }
        </Show>
      </div>
    </>
  );
}

function ReferralTable(props: {
  partnerId: string;
  referrals: Referral[];
  grouped: boolean;
}) {
  const groups = () =>
    props.grouped
      ? columnsByTeam(props.referrals, teamsFor(props.partnerId)).filter(
          (column) => column.referrals.length > 0
        )
      : [
          {
            teamId: null,
            name: '',
            memberCount: null,
            referrals: props.referrals,
          },
        ];
  const headers = [
    t('partners.fieldName'),
    t('partners.columnCompany'),
    t('partners.fieldEmail'),
    t('partners.pricingTier'),
    t('partners.stageLabel'),
    t('partners.teamLabel'),
    t('partners.memberCountLabel'),
  ];
  return (
    <div class="overflow-x-auto">
      <div
        role="table"
        aria-label={t('partners.tabReferrals')}
        class={`grid border-b border-edge-muted text-sm ${REFERRAL_COLUMNS}`}
      >
        <div
          role="row"
          class="col-span-full grid grid-cols-subgrid sticky top-0 z-1 min-h-10 border-b border-edge-muted bg-panel text-xs text-ink-muted"
        >
          <For each={headers}>
            {(header) => (
              <div role="columnheader" class="flex items-center truncate px-3">
                {header}
              </div>
            )}
          </For>
        </div>
        <For each={groups()}>
          {(group) => (
            <>
              <Show when={props.grouped}>
                <div
                  role="row"
                  class="col-span-full flex min-h-9 items-center gap-3 border-b border-edge bg-surface px-3"
                >
                  <span class="text-sm font-medium text-ink">
                    {group.teamId ? group.name : t('partners.noTeam')}
                  </span>
                  <span class="text-xs text-ink-muted">
                    {group.memberCount === null
                      ? t('partners.referredCount', {
                          count: group.referrals.length,
                        })
                      : t('partners.memberCount', {
                          count: group.memberCount,
                        })}
                  </span>
                </div>
              </Show>
              <For each={group.referrals}>
                {(referral) => (
                  <div
                    role="row"
                    class="col-span-full grid grid-cols-subgrid min-h-10 border-b border-edge-muted/60 hover:bg-hover/50"
                  >
                    <ReferralCells
                      referral={referral}
                      partnerId={props.partnerId}
                    />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

/** Staff database of a partner’s referrals. By team breaks the table on a team header. */
export function ReferralList(props: { partnerId: string }) {
  const [layout, setLayout] = createSignal<'all' | 'team'>('all');
  const rows = () => referralsFor(props.partnerId);

  return (
    <div class="flex flex-col gap-3">
      <Tabs
        aria-label={t('partners.referralViews')}
        size="sm"
        value={layout()}
        onChange={setLayout}
        options={[
          { value: 'all', label: t('partners.viewList') },
          { value: 'team', label: t('partners.viewByTeam') },
        ]}
      />
      <Show
        when={rows().length > 0}
        fallback={
          <p class="text-sm text-ink-muted">{t('partners.emptyReferrals')}</p>
        }
      >
        <ReferralTable
          partnerId={props.partnerId}
          referrals={rows()}
          grouped={layout() === 'team'}
        />
      </Show>
    </div>
  );
}

export function PipelineBoard(props: { partnerId: string }) {
  const [layout, setLayout] = createSignal<Layout>('pipeline');
  const referrals = () => referralsFor(props.partnerId);
  const columns = () => {
    if (layout() === 'pipeline') {
      return columnsByStage(referrals()).map((column) => ({
        key: column.stage,
        title: stageLabel(column.stage),
        detail: t('partners.referredCount', {
          count: column.referrals.length,
        }),
        referrals: column.referrals,
      }));
    }
    return columnsByTeam(referrals(), teamsFor(props.partnerId)).map(
      (column) => ({
        key: column.teamId ?? 'none',
        title: column.teamId ? column.name : t('partners.noTeam'),
        detail:
          column.memberCount === null
            ? t('partners.referredCount', { count: column.referrals.length })
            : t('partners.memberCount', { count: column.memberCount }),
        referrals: column.referrals,
      })
    );
  };

  return (
    <div class="flex flex-col gap-3">
      <p class="text-sm text-ink-muted">{t('partners.pipelineHelp')}</p>
      <Tabs
        aria-label={t('partners.referralViews')}
        size="sm"
        value={layout()}
        onChange={setLayout}
        options={[
          { value: 'pipeline', label: t('partners.viewPipeline') },
          { value: 'team', label: t('partners.viewByTeam') },
        ]}
      />
      <div class="flex gap-3 overflow-x-auto pb-1">
        <For each={columns()}>
          {(column) => (
            <section class="flex w-64 shrink-0 flex-col gap-2">
              <header class="flex flex-col gap-0.5">
                <h2 class="text-sm font-medium text-ink">{column.title}</h2>
                <p class="text-xs text-ink-muted">{column.detail}</p>
              </header>
              <Show when={column.referrals.length === 0}>
                <p class="text-xs text-ink-muted">
                  {t('partners.emptyColumn')}
                </p>
              </Show>
              <For each={column.referrals}>
                {(referral) => (
                  <ReferralCard
                    referral={referral}
                    partnerId={props.partnerId}
                  />
                )}
              </For>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}

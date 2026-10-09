import { createSignal } from 'solid-js';
import { PLAN_BY_TIER } from '../paywall/plans';
import type { BillingContext } from '../settings/context/billing-context';
import type { UsageContext } from '../usage/context/usage-context';
import { toUsageSummary } from '../usage/queries/usage-summary';
import {
  advanceDays,
  type BillingSimulation,
  changePlan,
  createScenario,
  includedCents,
  renew,
  type ScenarioId,
  setUsage,
} from './core/billing-simulation';
import { fixtureSnapshot } from './queries/fixture-snapshot';

export type LabSurface = 'billing' | 'usage';
export type LabPayment =
  | { kind: 'credits'; amountCents: number }
  | { kind: 'subscription'; tier: 'premium' | 'max' }
  | { kind: 'methods' };

export function createBillingLab(initial: ScenarioId) {
  const [state, setState] = createSignal(createScenario(initial));
  const [surface, setSurface] = createSignal<LabSurface>('billing');
  const [pending, setPending] = createSignal(false);
  const [failNext, setFailNext] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  const [limitOpen, setLimitOpen] = createSignal(false);
  const [payment, setPayment] = createSignal<LabPayment>();
  const [events, setEvents] = createSignal<
    { id: number; at: string; label: string }[]
  >([]);
  let generation = 0;
  let nextEvent = 0;
  const record = (label: string) => {
    setNotice(label);
    setEvents((previous) =>
      [{ id: ++nextEvent, at: state().now, label }, ...previous].slice(0, 12)
    );
  };
  const update = (
    apply: (state: BillingSimulation) => BillingSimulation,
    label: string
  ) => {
    setState(apply);
    record(label);
  };
  const selectScenario = (scenario: ScenarioId) => {
    generation++;
    setState(createScenario(scenario));
    setPending(false);
    setFailNext(false);
    setLimitOpen(false);
    setPayment(undefined);
    setEvents([]);
    setNotice('');
  };
  const perform = async (label: string, action: () => void) => {
    const current = generation;
    setPending(true);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      if (generation !== current) return;
      if (failNext()) {
        setFailNext(false);
        record(`${label} failed — simulated request error`);
        throw new Error('Simulated billing request failure');
      }
      action();
    } finally {
      if (generation === current) setPending(false);
    }
  };
  const openPayment = (value: LabPayment) => {
    setPayment(value);
    record('Opened simulated payment flow');
  };
  const startBillingPayment = async (value: LabPayment) => {
    try {
      await perform('Payment flow', () => openPayment(value));
    } catch {
      // Billing's simulated failure is visible in the lab notice.
    }
  };
  const billing: BillingContext = {
    tier: () => state().tier,
    renewalDate: () => state().periodEnd,
    scheduledChange: () => {
      const plan = state().scheduledPlan;
      return plan ? { plan, effectiveAt: state().periodEnd } : undefined;
    },
    hasPaid: () => state().tier !== 'free',
    aiUsageBilling: () => state().status !== 'before-launch',
    teamRole: () =>
      state().role === 'solo'
        ? undefined
        : state().role === 'owner'
          ? 'owner'
          : 'member',
    teamSeatDescription: () =>
      state().role === 'owner'
        ? '4 users • 3 Pro seats, 1 Max seat'
        : undefined,
    billedThroughTeam: () => state().role === 'member',
    isOwnerOrSolo: () => state().role !== 'member',
    canManageSubscription: () => state().role !== 'member',
    canChangePlan: () => state().role !== 'member',
    changingPlan: pending,
    checkout: (tier) => startBillingPayment({ kind: 'subscription', tier }),
    manage: () => startBillingPayment({ kind: 'methods' }),
    openTeamSettings: () =>
      record('Team settings navigation requested (simulated)'),
    changePlan: async (tier) => {
      try {
        await perform('Plan change', () => {
          const previous = state();
          const next = changePlan(previous, tier);
          setState(next);
          record(
            next.scheduledPlan
              ? `${PLAN_BY_TIER[tier].name} scheduled for renewal; ${PLAN_BY_TIER[previous.tier].name} stays active`
              : previous.tier === tier
                ? 'Scheduled change canceled; active plan and usage preserved'
                : `${PLAN_BY_TIER[tier].name} active; included usage reset`
          );
        });
      } catch {
        // The lab notice exposes the simulated failure; no remote mutation runs.
      }
    },
  };
  const manageable = () =>
    state().role !== 'member' && state().tier !== 'free' && !state().unlimited;
  const usage: UsageContext = {
    available: () => state().status !== 'before-launch',
    summary: () =>
      state().status === 'loading' || state().status === 'error'
        ? undefined
        : toUsageSummary(fixtureSnapshot(state())),
    loading: () => state().status === 'loading',
    failed: () => state().status === 'error',
    refresh: () =>
      update(
        (value) => ({ ...value, status: 'ready' }),
        'Usage summary loaded'
      ),
    checkout: {
      pending,
      supportedAmounts: () => [2_500, 5_000, 10_000],
      start: async (amountCents) => {
        await perform('Credit checkout', () =>
          openPayment({ kind: 'credits', amountCents })
        );
        return 'billing-lab:checkout';
      },
    },
    autoReload: {
      settings: () => state().autoReload,
      available: manageable,
      pending,
      suspended: () => state().reloadSuspended,
      preview: () => false,
      save: async (settings) =>
        await perform('Automatic reload update', () =>
          update(
            (value) => ({
              ...value,
              autoReload: settings,
              overageEnabled: settings.enabled,
              reloadSuspended: false,
              overageSuspended: false,
            }),
            'Automatic reload settings saved'
          )
        ),
    },
    paymentMethods: {
      pending,
      open: async () => {
        await perform('Payment methods', () =>
          openPayment({ kind: 'methods' })
        );
        return 'billing-lab:payment-methods';
      },
    },
    existingUsageBilling: {
      pending,
      turnOff: async () =>
        await perform('Usage billing update', () =>
          update(
            (value) => ({
              ...value,
              overageEnabled: false,
              overageSuspended: false,
              autoReload: { ...value.autoReload, enabled: false },
            }),
            'Usage billing turned off'
          )
        ),
    },
    // Payment completion is explicit in the lab; never navigate to a hosted URL.
    navigateToPayment: () => {},
    openPlans: () => setSurface('billing'),
  };

  return {
    state,
    surface,
    setSurface,
    pending,
    failNext,
    setFailNext,
    notice,
    events,
    limitOpen,
    setLimitOpen,
    payment,
    setPayment,
    billing,
    usage,
    selectScenario,
    setUsage: (percentage: number) =>
      setState((value) => setUsage(value, percentage)),
    setCredits: (cents: number) =>
      setState((value) => ({
        ...value,
        creditBalanceCents: cents,
        blockedReason: cents > 0 ? undefined : value.blockedReason,
      })),
    advance: (days: number) =>
      update(
        (value) => advanceDays(value, days),
        `Advanced ${days} day${days === 1 ? '' : 's'}`
      ),
    renew: () => update(renew, 'Billing cycle renewed; included usage reset'),
    cancelChange: () =>
      update(
        (value) => ({ ...value, scheduledPlan: undefined }),
        'Scheduled change canceled; active plan and usage preserved'
      ),
    exhaust: () =>
      update((value) => setUsage(value, 100), 'Included usage exhausted'),
    completePayment: async () => {
      const selected = payment();
      if (!selected) return;
      await perform('Payment', () => {
        if (selected.kind === 'credits')
          update(
            (value) => ({
              ...value,
              creditBalanceCents:
                value.creditBalanceCents + selected.amountCents,
              blockedReason: undefined,
            }),
            'Credits added to the simulated account'
          );
        if (selected.kind === 'subscription')
          update(
            (value) => changePlan(value, selected.tier),
            'Simulated subscription activated'
          );
        if (selected.kind === 'methods')
          update(
            (value) => ({
              ...value,
              reloadSuspended: false,
              overageSuspended: false,
              blockedReason: undefined,
            }),
            'Simulated payment method updated'
          );
        setPayment(undefined);
      });
    },
    percentage: () =>
      Math.round((state().usedCents / includedCents(state())) * 100),
  };
}

export type BillingLab = ReturnType<typeof createBillingLab>;

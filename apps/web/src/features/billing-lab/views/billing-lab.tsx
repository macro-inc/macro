import ArrowClockwiseIcon from '@phosphor/arrow-clockwise.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import FlaskIcon from '@phosphor/flask.svg';
import { Button, Dialog, Layer, Surface } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { AiUsageLimitDialogView } from '../../paywall/components/ai-usage-limit-dialog';
import { PLAN_BY_TIER } from '../../paywall/plans';
import { BillingSettingsView } from '../../settings/views/billing-settings';
import { formatCreditBalance } from '../../usage/core/usage';
import { UsageSettingsView } from '../../usage/views/usage-settings';
import { SCENARIOS, type ScenarioId } from '../core/billing-simulation';
import type { BillingLab, LabPayment } from '../create-billing-lab';

function ControlSection(props: { title: string; children: JSX.Element }) {
  return (
    <section class="flex flex-col gap-4 border-t border-edge-muted pt-5">
      <h3 class="text-xs font-medium tracking-wide text-ink-muted">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function Metric(props: { label: string; value: string; detail: string }) {
  return (
    <div class="min-w-0 rounded-xl border border-edge-muted bg-surface p-4">
      <p class="text-[11px] text-ink-muted">{props.label}</p>
      <p class="mt-1 text-xl font-medium tracking-tight text-ink">
        {props.value}
      </p>
      <p class="mt-1 truncate text-[11px] text-ink-extra-muted">
        {props.detail}
      </p>
    </div>
  );
}

function PaymentSummary(props: { payment: LabPayment }) {
  return (
    <p>
      {match(props.payment)
        .with(
          { kind: 'credits' },
          (payment) =>
            `Add ${formatCreditBalance(payment.amountCents)} in usage credits`
        )
        .with(
          { kind: 'subscription' },
          (payment) => `Start a ${PLAN_BY_TIER[payment.tier].name} subscription`
        )
        .with(
          { kind: 'methods' },
          () =>
            'Update the payment method and clear the simulated payment failure.'
        )
        .exhaustive()}
    </p>
  );
}

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

export function BillingLabView(props: {
  lab: BillingLab;
  onSelect: (id: ScenarioId) => void;
}) {
  const lab = props.lab;
  const [compact, setCompact] = createSignal(false);
  const [paymentError, setPaymentError] = createSignal<string>();
  const [copied, setCopied] = createSignal(false);
  const selectedScenario = () =>
    SCENARIOS.find((scenario) => scenario.id === lab.state().scenario)!;
  const cycleProgress = () =>
    Math.min(
      100,
      Math.max(
        0,
        ((Date.parse(lab.state().now) - Date.parse(lab.state().periodStart)) /
          (Date.parse(lab.state().periodEnd) -
            Date.parse(lab.state().periodStart))) *
          100
      )
    );
  const remainingDays = () =>
    Math.ceil(
      (Date.parse(lab.state().periodEnd) - Date.parse(lab.state().now)) /
        86_400_000
    );
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const completePayment = async () => {
    setPaymentError(undefined);
    try {
      await lab.completePayment();
    } catch {
      setPaymentError('Simulated payment failed. Try again or cancel.');
    }
  };

  return (
    <Layer depth={1}>
      <div class="h-screen overflow-y-auto bg-panel text-ink font-sans">
        <header class="flex flex-wrap items-center justify-between gap-4 border-b border-edge-muted bg-surface px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
              <FlaskIcon class="size-5" />
            </div>
            <div>
              <h1 class="text-base font-semibold tracking-tight">
                Billing Lab
              </h1>
              <p class="mt-0.5 text-xs text-ink-muted">
                A workspace for every moment in the billing cycle
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="flex items-center gap-1.5 rounded-full border border-success/20 bg-success/5 px-2.5 py-1 text-[11px] text-success">
              <span class="size-1.5 rounded-full bg-success" />
              Local simulation
            </span>
            <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
              {copied() ? 'Scenario link copied' : 'Copy scenario link'}
            </Button>
          </div>
        </header>
        <div class="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_280px]">
          <aside class="flex flex-col gap-5 border-b border-edge-muted bg-surface/60 p-5 lg:border-b-0 lg:border-r">
            <div class="flex items-center justify-between">
              <h2 class="text-xs font-semibold tracking-wide text-ink-muted">
                SCENARIOS
              </h2>
              <span class="font-mono text-[10px] text-ink-extra-muted">
                {SCENARIOS.length} states
              </span>
            </div>
            <For each={['Plan changes', 'Usage & credits', 'Access & loading']}>
              {(group) => (
                <section class="flex flex-col gap-1">
                  <h3 class="mb-2 text-[11px] text-ink-extra-muted">{group}</h3>
                  <For
                    each={SCENARIOS.filter(
                      (scenario) => scenario.group === group
                    )}
                  >
                    {(scenario) => (
                      <button
                        type="button"
                        aria-pressed={lab.state().scenario === scenario.id}
                        class="flex items-center justify-between gap-2 rounded-lg border border-transparent px-3 py-2.5 text-left text-xs transition-colors hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
                        classList={{
                          'bg-accent/8 !border-accent/20 text-accent':
                            lab.state().scenario === scenario.id,
                          'text-ink-muted':
                            lab.state().scenario !== scenario.id,
                        }}
                        onClick={() => {
                          setPaymentError(undefined);
                          setCopied(false);
                          props.onSelect(scenario.id);
                        }}
                      >
                        {scenario.title}
                        <Show when={lab.state().scenario === scenario.id}>
                          <ArrowRightIcon class="size-3 shrink-0" />
                        </Show>
                      </button>
                    )}
                  </For>
                </section>
              )}
            </For>
            <p class="mt-auto rounded-lg bg-active p-3 text-[11px] leading-relaxed text-ink-extra-muted">
              Every control changes a local fixture. No account, payment, or
              subscription is changed.
            </p>
          </aside>

          <main class="flex min-w-0 flex-col gap-5 p-5 xl:p-8">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="mb-2 text-[11px] font-medium tracking-wider text-accent">
                  BILLING CYCLE / {selectedScenario().group.toUpperCase()}
                </p>
                <h2 class="text-2xl font-medium tracking-tight">
                  {selectedScenario().title}
                </h2>
                <p class="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                  {selectedScenario().description}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                label="Reset scenario"
                onClick={() => {
                  lab.selectScenario(lab.state().scenario);
                  setPaymentError(undefined);
                }}
              >
                <ArrowClockwiseIcon class="size-3.5" />
                Reset
              </Button>
            </div>
            <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Metric
                label="Active plan"
                value={PLAN_BY_TIER[lab.state().tier].name}
                detail={
                  lab.state().role === 'member'
                    ? 'Paid by team'
                    : lab.state().role === 'owner'
                      ? '4 seats • mixed plans'
                      : 'Personal subscription'
                }
              />
              <Metric
                label="Included usage"
                value={
                  lab.state().unlimited ? 'Unlimited' : `${lab.percentage()}%`
                }
                detail={
                  lab.state().unlimited
                    ? 'No monthly limit'
                    : 'Used in this billing cycle'
                }
              />
              <Metric
                label="Credits"
                value={formatCreditBalance(lab.state().creditBalanceCents)}
                detail="Prepaid balance carries over"
              />
              <Metric
                label="Next renewal"
                value={dateLabel(lab.state().periodEnd)}
                detail={`${remainingDays()} days from simulated today`}
              />
            </div>

            <section
              class="rounded-xl border border-edge-muted bg-surface p-5"
              aria-label="Billing cycle timeline"
            >
              <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span class="flex items-center gap-2 font-medium">
                  <CalendarIcon class="size-4 text-ink-muted" />
                  Current billing cycle
                </span>
                <span class="text-ink-muted">
                  Today: {dateLabel(lab.state().now)},{' '}
                  {new Date(lab.state().now).getUTCFullYear()}
                </span>
              </div>
              <div class="relative my-5 h-1.5 rounded-full bg-active">
                <div
                  class="h-full rounded-full bg-accent/70"
                  style={{ width: `${cycleProgress()}%` }}
                />
                <span
                  class="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent ring-2 ring-accent/15"
                  style={{ left: `${cycleProgress()}%` }}
                />
              </div>
              <div class="flex justify-between text-[11px] text-ink-muted">
                <span>{dateLabel(lab.state().periodStart)} · cycle starts</span>
                <span>{dateLabel(lab.state().periodEnd)} · renews</span>
              </div>
              <Show when={lab.state().scheduledPlan}>
                {(plan) => (
                  <div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent/5 px-3 py-2.5 text-xs">
                    <span>
                      {PLAN_BY_TIER[lab.state().tier].name} stays active until{' '}
                      {dateLabel(lab.state().periodEnd)}.{' '}
                      <strong class="font-medium">
                        {PLAN_BY_TIER[plan()].name} starts at renewal.
                      </strong>
                    </span>
                    <button
                      type="button"
                      class="text-link hover:text-link-hover disabled:opacity-50"
                      disabled={lab.pending()}
                      onClick={lab.cancelChange}
                    >
                      Cancel scheduled change
                    </button>
                  </div>
                )}
              </Show>
            </section>

            <section
              class="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-xl border border-edge-muted bg-surface shadow-sm"
              aria-label="Live application preview"
            >
              <div class="flex flex-wrap items-center justify-between gap-3 border-b border-edge-muted p-2.5">
                <div
                  class="flex items-center gap-1"
                  role="group"
                  aria-label="Preview surface"
                >
                  <For each={['billing', 'usage'] as const}>
                    {(surface) => (
                      <button
                        type="button"
                        aria-pressed={lab.surface() === surface}
                        class="rounded-lg px-4 py-2 text-xs font-medium hover:bg-active focus-visible:outline-2 focus-visible:outline-accent"
                        classList={{
                          'bg-active text-ink': lab.surface() === surface,
                          'text-ink-muted': lab.surface() !== surface,
                        }}
                        onClick={() => lab.setSurface(surface)}
                      >
                        {surface === 'billing'
                          ? 'Billing settings'
                          : 'Usage settings'}
                      </button>
                    )}
                  </For>
                </div>
                <div class="flex items-center gap-2 text-[11px] text-ink-extra-muted">
                  <span>Real app components</span>
                  <button
                    type="button"
                    aria-pressed={compact()}
                    class="rounded-md border border-edge-muted px-2 py-1 text-ink-muted hover:bg-active"
                    onClick={() => setCompact(!compact())}
                  >
                    {compact() ? 'Compact' : 'Full width'}
                  </button>
                </div>
              </div>
              <div
                class="mx-auto h-[720px] w-full min-w-0 overflow-hidden transition-[max-width]"
                style={{ 'max-width': compact() ? '420px' : 'none' }}
              >
                <Show
                  when={lab.surface() === 'billing'}
                  fallback={<UsageSettingsView context={lab.usage} />}
                >
                  <BillingSettingsView context={lab.billing} />
                </Show>
              </div>
            </section>
            <Show when={lab.notice()}>
              <p
                class="rounded-lg border border-edge-muted bg-surface px-4 py-3 text-xs text-ink-muted"
                role="status"
              >
                {lab.notice()}
              </p>
            </Show>
          </main>

          <aside class="flex flex-col gap-5 border-t border-edge-muted bg-surface/60 p-5 lg:border-l lg:border-t-0">
            <div>
              <h2 class="text-xs font-semibold tracking-wide text-ink-muted">
                CONTROLS
              </h2>
              <p class="mt-2 text-[11px] leading-relaxed text-ink-extra-muted">
                Move time, change usage, then inspect the app.
              </p>
            </div>
            <ControlSection title="Time travel">
              <div class="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lab.pending()}
                  onClick={() => lab.advance(1)}
                >
                  +1 day
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lab.pending()}
                  onClick={() => lab.advance(7)}
                >
                  +7 days
                </Button>
              </div>
              <Button
                variant="accent"
                size="sm"
                disabled={lab.pending()}
                onClick={lab.renew}
              >
                Advance to renewal
                <ArrowRightIcon class="size-3.5" />
              </Button>
              <p class="text-[11px] leading-relaxed text-ink-extra-muted">
                Renewal applies the scheduled plan and resets included usage.
                Credits carry over.
              </p>
            </ControlSection>
            <ControlSection title="Usage & balance">
              <label class="flex flex-col gap-3 text-xs">
                <span class="flex justify-between">
                  Included usage
                  <span class="font-mono text-ink-muted">
                    {lab.percentage()}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={lab.percentage()}
                  aria-label="Included usage percent"
                  class="w-full accent-accent"
                  onInput={(event) =>
                    lab.setUsage(Number(event.currentTarget.value))
                  }
                />
              </label>
              <Button variant="outline" size="sm" onClick={lab.exhaust}>
                Exhaust included usage
              </Button>
              <label class="flex flex-col gap-2 text-xs">
                Credit balance ($)
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={lab.state().creditBalanceCents / 100}
                  class="rounded-lg border border-edge-muted bg-panel px-3 py-2 text-sm outline-none focus:border-accent"
                  onInput={(event) => {
                    const amount = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(amount))
                      lab.setCredits(
                        Math.round(Math.max(0, Math.min(100000, amount)) * 100)
                      );
                  }}
                />
              </label>
            </ControlSection>
            <ControlSection title="Dialogs & requests">
              <Button
                variant="outline"
                size="sm"
                onClick={() => lab.setLimitOpen(true)}
              >
                Open usage-limit dialog
              </Button>
              <label class="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  class="accent-accent"
                  checked={lab.failNext()}
                  onChange={(event) =>
                    lab.setFailNext(event.currentTarget.checked)
                  }
                />
                Fail the next billing request
              </label>
              <p class="text-[11px] leading-relaxed text-ink-extra-muted">
                Purchases open a simulated checkout. Complete or fail them to
                inspect success and error states.
              </p>
            </ControlSection>
            <ControlSection title="Event history">
              <Show
                when={lab.events().length > 0}
                fallback={
                  <p class="text-[11px] leading-relaxed text-ink-extra-muted">
                    Select a scenario, then try an action. Changes will appear
                    here.
                  </p>
                }
              >
                <ol class="flex flex-col gap-4">
                  <For each={lab.events()}>
                    {(event) => (
                      <li class="flex gap-2.5">
                        <span class="mt-1 size-1.5 shrink-0 rounded-full bg-accent/60" />
                        <div>
                          <p class="text-[11px] leading-relaxed text-ink-muted">
                            {event.label}
                          </p>
                          <time class="mt-1 block font-mono text-[10px] text-ink-extra-muted">
                            {dateLabel(event.at)}
                          </time>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </ControlSection>
          </aside>
        </div>
      </div>

      <AiUsageLimitDialogView
        open={lab.limitOpen()}
        code={`ai_${lab.state().blockedReason ?? (lab.state().tier === 'free' ? 'free_allowance_exhausted' : 'allowance_exhausted')}`}
        freePlan={lab.state().tier === 'free'}
        usage={{
          percentage: lab.percentage(),
          periodEnd: lab.state().periodEnd,
          unlimited: lab.state().unlimited,
        }}
        previewNotice="Billing Lab · simulated account"
        onClose={() => lab.setLimitOpen(false)}
        onOpenSettings={() => {
          lab.setLimitOpen(false);
          lab.setSurface(lab.state().tier === 'free' ? 'billing' : 'usage');
        }}
      />
      <Dialog
        open={!!lab.payment()}
        onOpenChange={(open) => {
          if (!open) {
            lab.setPayment(undefined);
            setPaymentError(undefined);
          }
        }}
        position="center"
        class="w-120"
      >
        <Surface depth={2} class="rounded-xl">
          <div class="flex flex-col gap-5 p-6">
            <div>
              <Dialog.Title class="text-xl font-medium">
                {lab.payment()?.kind === 'methods'
                  ? 'Simulated payment methods'
                  : 'Simulated checkout'}
              </Dialog.Title>
              <Dialog.Description class="mt-2 text-sm text-ink-muted">
                This flow stays in Billing Lab. No charge will be made.
              </Dialog.Description>
            </div>
            <Show when={lab.payment()}>
              {(payment) => (
                <div class="rounded-lg bg-active p-4 text-sm">
                  <PaymentSummary payment={payment()} />
                </div>
              )}
            </Show>
            <Show when={paymentError()}>
              <p class="text-sm text-failure" role="alert">
                {paymentError()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  lab.setPayment(undefined);
                  setPaymentError(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="accent"
                disabled={lab.pending()}
                onClick={() => void completePayment()}
              >
                {lab.pending() ? 'Processing…' : 'Complete simulation'}
              </Button>
            </div>
          </div>
        </Surface>
      </Dialog>
    </Layer>
  );
}

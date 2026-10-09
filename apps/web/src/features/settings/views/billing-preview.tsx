import { PaywallDialog } from '@app/features/paywall/components/paywall-dialog';
import { PaywallView } from '@app/features/paywall/components/paywall-view';
import { PLAN_BY_TIER, type PlanTier } from '@app/features/paywall/plans';
import { Button } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { BillingSettingsView } from '../components/billing-settings-view';
import { getBillingState } from '../core/billing-state';

type Account = 'solo' | 'team-member' | 'self-paying-member' | 'team-owner';
type SummaryStatus = 'loaded' | 'loading' | 'failed';

function PreviewSelect<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label class="flex min-w-0 flex-col gap-1 text-xs text-ink-muted">
      {props.label}
      <select
        class="rounded-lg border border-edge-muted bg-input px-3 py-2 text-sm text-ink"
        value={props.value}
        onChange={(event) => {
          const option = props.options.find(
            (option) => option.value === event.currentTarget.value
          );
          if (option) props.onChange(option.value);
        }}
      >
        <For each={props.options}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </label>
  );
}

function PreviewCheckbox(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="flex items-center gap-2 py-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

/** Only loaded by Billing under the local HMR gate. Billing previews simulate actions. */
export function BillingPreview(props: {
  renderLive: (controls: JSX.Element) => JSX.Element;
}) {
  const [active, setActive] = createSignal(false);
  const [paywallOpen, setPaywallOpen] = createSignal(false);
  const [account, setAccount] = createSignal<Account>('solo');
  const [plan, setPlan] = createSignal<PlanTier>('free');
  const [summaryStatus, setSummaryStatus] =
    createSignal<SummaryStatus>('loaded');
  const [hasPaid, setHasPaid] = createSignal(false);
  const [permission, setPermission] = createSignal(true);
  const [aiUsage, setAiUsage] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [action, setAction] = createSignal('');
  const state = () =>
    getBillingState({
      hasPaid: hasPaid() || (summaryStatus() === 'loaded' && plan() !== 'free'),
      canManageSubscription: permission(),
      teamRole:
        account() === 'solo'
          ? undefined
          : account() === 'team-owner'
            ? 'owner'
            : 'member',
      teamPlans: ['premium', 'premium', 'max'],
      summary:
        summaryStatus() === 'loaded'
          ? { tier: plan(), canManageBilling: account() !== 'team-member' }
          : undefined,
      aiUsageEnabled: aiUsage(),
      pending: pending(),
    });
  const reset = () => {
    setAccount('solo');
    setPlan('free');
    setSummaryStatus('loaded');
    setHasPaid(false);
    setPermission(true);
    setAiUsage(false);
    setPending(false);
    setAction('');
  };

  const previewControls = () => (
    <section aria-label="Billing preview" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          Local preview · billing actions are simulated
        </p>
        <div class="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPaywallOpen(true)}
          >
            Preview paywall
          </Button>
          <Button size="sm" variant="outline" onClick={reset}>
            Reset preview
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              reset();
              setPaywallOpen(false);
              setActive(false);
            }}
          >
            Exit preview
          </Button>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-4 @sm:grid-cols-2">
        <PreviewSelect
          label="Account"
          value={account()}
          options={[
            { value: 'solo', label: 'Solo' },
            { value: 'team-member', label: 'Team member · team pays' },
            {
              value: 'self-paying-member',
              label: 'Team member · pays for own seat',
            },
            { value: 'team-owner', label: 'Team owner' },
          ]}
          onChange={(value) => {
            setAccount(value);
            setAction('');
          }}
        />
        <PreviewSelect
          label="Plan"
          value={plan()}
          options={(['free', 'premium', 'max'] as const).map((tier) => ({
            value: tier,
            label: PLAN_BY_TIER[tier].name,
          }))}
          onChange={(value) => {
            setPlan(value);
            setHasPaid(value !== 'free');
            setAction('');
          }}
        />
      </div>
      <details>
        <summary class="text-sm text-ink-muted">
          Permissions, loading, and feature states
        </summary>
        <div class="mt-3 flex flex-col gap-3">
          <PreviewSelect
            label="Billing summary"
            value={summaryStatus()}
            options={[
              { value: 'loaded', label: 'Loaded' },
              { value: 'loading', label: 'Loading' },
              { value: 'failed', label: 'Failed' },
            ]}
            onChange={setSummaryStatus}
          />
          <div class="flex flex-wrap gap-x-6">
            <PreviewCheckbox
              label="Billing permission"
              checked={permission()}
              onChange={setPermission}
            />
            <PreviewCheckbox
              label="Active or trialing license"
              checked={hasPaid()}
              onChange={setHasPaid}
            />
            <PreviewCheckbox
              label="AI usage billing enabled"
              checked={aiUsage()}
              onChange={setAiUsage}
            />
            <PreviewCheckbox
              label="Plan action pending"
              checked={pending()}
              onChange={setPending}
            />
          </div>
        </div>
      </details>
      <p role="status" class="text-xs text-ink-muted">
        {action() ||
          (state().canChangePlan
            ? 'Personal plan options available'
            : 'Personal plan options hidden')}
      </p>
    </section>
  );

  const selectPlan = (tier: 'premium' | 'max') =>
    setAction(
      `Preview only · ${state().tier === 'free' ? 'Checkout' : 'Change plan'}: ${PLAN_BY_TIER[tier].name}${state().tier === 'free' && tier === 'premium' ? ' · 30-day trial' : ''} · no billing changes made`
    );
  const manage = () =>
    setAction('Preview only · Manage subscription · no billing changes made');

  return (
    <Show
      when={active()}
      fallback={props.renderLive(
        <div class="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => setActive(true)}>
            Preview billing & paywall
          </Button>
          <span class="text-xs text-ink-muted">Local development</span>
        </div>
      )}
    >
      <BillingSettingsView
        state={state()}
        controls={previewControls()}
        onManage={manage}
        onSelectPlan={selectPlan}
        onTeamSettings={(event) => {
          event.preventDefault();
          setAction(
            'Preview only · Team settings manages teammates’ seat plans'
          );
        }}
      />
      <Show when={paywallOpen()}>
        <PaywallDialog
          open={paywallOpen()}
          onClose={() => setPaywallOpen(false)}
        >
          <PaywallView
            state={{ ...state(), hasPaid: state().tier !== 'free' }}
            availability={
              summaryStatus() === 'loaded'
                ? 'ready'
                : summaryStatus() === 'loading'
                  ? 'loading'
                  : 'error'
            }
            onManagePlan={() => {
              setPaywallOpen(false);
            }}
            onDismiss={() => {
              setPaywallOpen(false);
            }}
            onRetry={() => {
              setSummaryStatus('loaded');
              setAction('Preview only · Retried billing summary');
            }}
          />
        </PaywallDialog>
      </Show>
    </Show>
  );
}

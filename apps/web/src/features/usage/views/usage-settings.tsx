import { Button, cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import { MonthlyLimit } from '../components/monthly-limit';
import { UsageInfoDialog } from '../components/usage-info-dialog';
import type { UsageContext } from '../context/usage-context';
import { formatCreditBalance } from '../core/usage';
import { AutoReloadView } from './auto-reload';
import { CreditPurchaseView } from './credit-purchase';

export function UsageSettingsView(props: { context: UsageContext }) {
  const [infoOpen, setInfoOpen] = createSignal(false);
  const [purchaseOpen, setPurchaseOpen] = createSignal(false);
  const [autoReloadOpen, setAutoReloadOpen] = createSignal(false);
  const [billingError, setBillingError] = createSignal<string>();
  // Controlled dialogs have no Dialog.Trigger; restore their actual opener on close.
  let infoTrigger: HTMLButtonElement | undefined;
  let purchaseTrigger: HTMLButtonElement | undefined;
  let autoReloadTrigger: HTMLButtonElement | undefined;
  const turnOffUsageBilling = async () => {
    if (
      props.context.developer?.active() ||
      props.context.autoReload.preview() ||
      props.context.existingUsageBilling.pending()
    )
      return;
    setBillingError(undefined);
    try {
      await props.context.existingUsageBilling.turnOff();
    } catch {
      setBillingError("Couldn't turn off usage billing. Please try again.");
    }
  };
  return (
    <SettingsPage title="Usage">
      <Show when={!props.context.available()}>
        <SettingsCard>
          <div class="flex flex-col gap-2 p-6" role="status">
            <p class="font-medium text-ink">
              AI billing changes take effect on October 8, 2026.
            </p>
            <p class="text-sm text-ink-muted">
              Usage controls are unavailable until these changes take effect.
            </p>
          </div>
        </SettingsCard>
      </Show>
      <fieldset
        disabled={!props.context.available()}
        class="flex min-w-0 flex-col gap-12 touch:gap-6"
        classList={{ 'opacity-50': !props.context.available() }}
      >
        <Show
          when={props.context.summary()}
          fallback={
            <SettingsCard>
              <div class="flex flex-col gap-3 p-6" role="status">
                <p class="text-sm text-ink-muted">
                  {props.context.failed()
                    ? "Couldn't load usage. Please try again."
                    : 'Loading usage…'}
                </p>
                <Show when={props.context.failed()}>
                  <Button
                    class="self-start"
                    variant="outline"
                    depth={3}
                    onClick={props.context.refresh}
                  >
                    Try again
                  </Button>
                </Show>
              </div>
            </SettingsCard>
          }
        >
          {(summary) => (
            <>
              <SettingsCard>
                <div class="p-6">
                  <MonthlyLimit
                    percentage={summary().monthlyPercent}
                    periodEnd={summary().periodEnd}
                    unlimited={summary().unlimited}
                    onInfo={() => setInfoOpen(true)}
                    infoButtonRef={(button) => {
                      infoTrigger = button;
                    }}
                  />
                </div>
              </SettingsCard>
              <Show
                when={
                  summary().billingAccess === 'free' &&
                  !props.context.autoReload.preview()
                }
              >
                <SettingsCard>
                  <SettingsRow
                    label="Need more AI usage?"
                    description="Subscribe to a paid plan to keep going."
                  >
                    <Button
                      variant="accent"
                      depth={3}
                      size="sm"
                      onClick={props.context.openPlans}
                    >
                      View plans
                    </Button>
                  </SettingsRow>
                </SettingsCard>
              </Show>
              <Show
                when={
                  (!summary().unlimited &&
                    summary().billingAccess !== 'free') ||
                  props.context.autoReload.preview()
                }
              >
                <SettingsSection
                  title="Usage Credits"
                  description="Buy credits or turn on automatic reload to continue using Macro AI when you reach usage limits"
                >
                  <SettingsCard>
                    <SettingsRow
                      label={
                        <span class="font-medium">
                          {formatCreditBalance(summary().creditBalanceCents)}{' '}
                          credits remaining
                        </span>
                      }
                      description="Current balance"
                    >
                      <Button
                        ref={(button) => {
                          purchaseTrigger = button;
                        }}
                        variant="outline"
                        depth={3}
                        size="sm"
                        class="rounded-full px-4"
                        onClick={() => setPurchaseOpen(true)}
                      >
                        Add more
                      </Button>
                    </SettingsRow>
                    <SettingsRow label="Automatic reload">
                      <button
                        ref={(button) => {
                          autoReloadTrigger = button;
                        }}
                        type="button"
                        aria-label="Configure Automatic reload"
                        aria-haspopup="dialog"
                        aria-expanded={autoReloadOpen()}
                        class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                        classList={{
                          'bg-accent':
                            props.context.autoReload.settings().enabled,
                          'bg-ink-muted/40':
                            !props.context.autoReload.settings().enabled,
                        }}
                        onClick={() => setAutoReloadOpen(true)}
                      >
                        <span
                          aria-hidden="true"
                          class={cn(
                            'absolute left-0.5 size-4 rounded-full bg-surface transition-transform',
                            props.context.autoReload.settings().enabled &&
                              'translate-x-4'
                          )}
                        />
                        <span class="sr-only">
                          Currently{' '}
                          {props.context.autoReload.settings().enabled
                            ? 'on'
                            : 'off'}
                        </span>
                      </button>
                    </SettingsRow>
                  </SettingsCard>
                </SettingsSection>
              </Show>
              <Show when={summary().existingUsageBilling}>
                {(billing) => (
                  <SettingsSection
                    title="Existing usage billing"
                    description="This bills additional usage to your card after it happens. It does not automatically reload credits."
                  >
                    <SettingsCard>
                      <SettingsRow
                        label={
                          billing().suspended
                            ? 'Usage billing paused'
                            : 'Usage billing enabled'
                        }
                        description={`Limit: ${formatCreditBalance(billing().limitCents)} per period`}
                      >
                        <Show when={summary().billingAccess === 'payer'}>
                          <Button
                            variant="outline"
                            depth={3}
                            size="sm"
                            disabled={
                              props.context.existingUsageBilling.pending() ||
                              props.context.developer?.active() ||
                              props.context.autoReload.preview()
                            }
                            onClick={() => void turnOffUsageBilling()}
                          >
                            Turn off usage billing
                          </Button>
                        </Show>
                      </SettingsRow>
                    </SettingsCard>
                    <Show when={billingError()}>
                      <p class="text-sm text-failure" role="alert">
                        {billingError()}
                      </p>
                    </Show>
                  </SettingsSection>
                )}
              </Show>
            </>
          )}
        </Show>
        <Show when={props.context.developer}>
          {(developer) => (
            <SettingsSection
              title="Developer tools"
              description="Preview usage states without changing account billing."
            >
              <SettingsCard>
                <div class="flex flex-col gap-3 p-4">
                  <div class="flex flex-wrap gap-2">
                    <Button
                      variant={
                        developer().plan() === 'free' ? 'accent' : 'outline'
                      }
                      depth={3}
                      size="sm"
                      aria-pressed={developer().plan() === 'free'}
                      onClick={() => developer().previewPlan('free')}
                    >
                      Preview Free plan
                    </Button>
                    <Button
                      variant={
                        developer().plan() === 'paid' ? 'accent' : 'outline'
                      }
                      depth={3}
                      size="sm"
                      aria-pressed={developer().plan() === 'paid'}
                      onClick={() => developer().previewPlan('paid')}
                    >
                      Preview paid plan
                    </Button>
                    <Button
                      variant="outline"
                      depth={3}
                      size="sm"
                      onClick={() => developer().openLimitDialog('free')}
                    >
                      Open Free usage-limit dialog
                    </Button>
                    <Button
                      variant="outline"
                      depth={3}
                      size="sm"
                      onClick={() => developer().openLimitDialog('paid')}
                    >
                      Open paid usage-limit dialog
                    </Button>
                    <Button
                      variant="ghost"
                      depth={3}
                      size="sm"
                      disabled={!developer().active()}
                      onClick={developer().reset}
                    >
                      Reset preview
                    </Button>
                  </div>
                  <Show when={developer().active()}>
                    <p class="text-xs text-ink-muted" role="status">
                      Developer preview active. No purchases or automatic
                      charges can be made. Reset the preview to restore real
                      usage.
                    </p>
                  </Show>
                </div>
              </SettingsCard>
            </SettingsSection>
          )}
        </Show>
      </fieldset>
      <Show when={props.context.available() && infoOpen()}>
        <UsageInfoDialog
          open={infoOpen()}
          onClose={() => setInfoOpen(false)}
          onRestoreFocus={() => infoTrigger?.focus()}
        />
      </Show>
      <Show when={props.context.available() && purchaseOpen()}>
        <CreditPurchaseView
          context={props.context}
          onClose={() => setPurchaseOpen(false)}
          onRestoreFocus={() => purchaseTrigger?.focus()}
        />
      </Show>
      <Show when={props.context.available() && autoReloadOpen()}>
        <AutoReloadView
          context={props.context}
          onClose={() => setAutoReloadOpen(false)}
          onRestoreFocus={() => autoReloadTrigger?.focus()}
        />
      </Show>
    </SettingsPage>
  );
}

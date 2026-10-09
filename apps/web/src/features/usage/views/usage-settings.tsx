import { Button, cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import {
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../../settings/primitives';
import { AutoReloadLimitNotice } from '../components/auto-reload-limit-notice';
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
  // Controlled dialogs have no Dialog.Trigger; restore their actual opener on close.
  let infoTrigger: HTMLButtonElement | undefined;
  let purchaseTrigger: HTMLButtonElement | undefined;
  let autoReloadTrigger: HTMLButtonElement | undefined;
  const reloadLimit = () => {
    const budget = props.context.autoReload.budget?.();
    return props.context.autoReload.settings().enabled &&
      !props.context.autoReload.suspended() &&
      budget &&
      budget.spentCents >= budget.limitCents
      ? budget
      : undefined;
  };
  const reloadLimitNotice = () => (
    <Show when={reloadLimit()}>
      {(budget) => (
        <AutoReloadLimitNotice
          budget={budget()}
          canManage={
            props.context.summary()?.billingAccess === 'payer' &&
            props.context.autoReload.available()
          }
          pending={
            props.context.autoReload.pending() ||
            props.context.checkout.pending()
          }
          onAdjust={(trigger) => {
            autoReloadTrigger = trigger;
            setAutoReloadOpen(true);
          }}
          onAddCredits={(trigger) => {
            purchaseTrigger = trigger;
            setPurchaseOpen(true);
          }}
        />
      )}
    </Show>
  );
  return (
    <SettingsPage title="Usage">
      <Show when={!props.context.available()}>
        <SettingsCard>
          <div class="flex flex-col gap-2 p-6" role="status">
            <p class="font-medium text-ink">
              AI billing changes take effect on October 8, 2026.
            </p>
            <p class="text-sm text-ink-muted">
              Usage is not metered until these changes take effect.
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
                  <Show
                    when={
                      summary().billingAccess === 'payer' &&
                      summary().creditScope === 'team' &&
                      !summary().unlimited
                    }
                  >
                    <p class="mt-3 text-xs text-ink-muted">
                      This is your personal monthly usage limit.
                    </p>
                  </Show>
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
                  title={
                    summary().creditScope === 'team' &&
                    summary().billingAccess === 'payer'
                      ? 'Team Usage Credits'
                      : 'Usage Credits'
                  }
                  description={
                    summary().billingAccess === 'team-member'
                      ? undefined
                      : summary().creditScope === 'team'
                        ? 'Credits are shared by your entire team.'
                        : 'Buy credits or turn on automatic reload to continue using Macro AI when you reach usage limits'
                  }
                >
                  <Show
                    when={summary().billingAccess === 'team-member'}
                    fallback={
                      <>
                        {reloadLimitNotice()}
                        <SettingsCard>
                          <SettingsRow
                            label={
                              <span class="font-medium">
                                {formatCreditBalance(
                                  summary().creditBalanceCents
                                )}{' '}
                                credits remaining
                              </span>
                            }
                            description={
                              summary().creditScope === 'team'
                                ? 'Shared team balance'
                                : 'Current balance'
                            }
                          >
                            <Show when={summary().billingAccess === 'payer'}>
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
                            </Show>
                          </SettingsRow>
                          <SettingsRow
                            label="Automatic reload"
                            description={
                              props.context.autoReload.suspended() ? (
                                <span role="status" class="text-failure">
                                  Paused — payment failed. Update your payment
                                  method, then save to retry.
                                </span>
                              ) : summary().creditScope === 'team' ? (
                                'Reloads credits for your entire team.'
                              ) : undefined
                            }
                          >
                            <button
                              ref={(button) => {
                                autoReloadTrigger = button;
                              }}
                              type="button"
                              aria-label="Configure Automatic reload"
                              aria-haspopup="dialog"
                              aria-expanded={autoReloadOpen()}
                              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-50"
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
                                {props.context.autoReload.suspended()
                                  ? 'Paused after a failed payment. Setting currently '
                                  : reloadLimit()
                                    ? 'Monthly limit reached. Setting currently '
                                    : 'Currently '}
                                {props.context.autoReload.settings().enabled
                                  ? 'on'
                                  : 'off'}
                              </span>
                            </button>
                          </SettingsRow>
                        </SettingsCard>
                      </>
                    }
                  >
                    <SettingsCard>
                      <p class="p-4 text-sm text-ink-muted">
                        Usage credits are managed by your team.
                      </p>
                    </SettingsCard>
                  </Show>
                </SettingsSection>
              </Show>
            </>
          )}
        </Show>
      </fieldset>
      <Show when={props.context.developer}>
        {(developer) => (
          <SettingsSection
            title="Developer tools"
            description="Preview usage states without changing account billing."
          >
            <SettingsCard>
              <div class="flex flex-col gap-3 p-4">
                <Show when={developer().openBillingLab}>
                  {(open) => (
                    <Button
                      variant="accent"
                      depth={3}
                      size="sm"
                      class="self-start"
                      onClick={open()}
                    >
                      Open Billing Lab
                    </Button>
                  )}
                </Show>
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
                    disabled={developer().beforeLaunch()}
                    onClick={() => developer().openLimitDialog('free')}
                  >
                    Open Free usage-limit dialog
                  </Button>
                  <Button
                    variant="outline"
                    depth={3}
                    size="sm"
                    disabled={developer().beforeLaunch()}
                    onClick={() => developer().openLimitDialog('paid')}
                  >
                    Open paid usage-limit dialog
                  </Button>
                  <Button
                    variant={developer().beforeLaunch() ? 'accent' : 'outline'}
                    depth={3}
                    size="sm"
                    aria-pressed={developer().beforeLaunch()}
                    onClick={developer().previewBeforeLaunch}
                  >
                    Preview production before Oct 8
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
                    Developer preview active. No purchases or automatic charges
                    can be made. Reset the preview to restore real usage.
                  </p>
                </Show>
              </div>
            </SettingsCard>
          </SettingsSection>
        )}
      </Show>
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

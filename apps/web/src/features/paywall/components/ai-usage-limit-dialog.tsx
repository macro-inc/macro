import type { AiDenyCode } from '@service-auth/ai-billing-types';
import { Button, Dialog, InputGroup, Surface, Tabs, TextField } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { formatCreditBalance } from '../../usage/core/usage';

const TITLES: Record<AiDenyCode, string> = {
  ai_allowance_exhausted: "You've used this month's included AI",
  ai_free_allowance_exhausted: "You've used this month's free AI",
  ai_overage_limit_reached: "You've hit your AI spending limit",
  ai_overage_payment_failed: 'Your last AI usage charge failed',
};

export type PurchaseMode = 'credits' | 'auto-reload';

/**
 * Ways a paid user can keep going: buy credits once on the card on file (the
 * team's card for a member), or, for the payer, turn on Auto-Reload.
 */
export type PurchaseOffer = {
  mode: PurchaseMode;
  /** Credit packs in cents, and the one selected. */
  packsCents: number[];
  packCents: number;
  /** The purchase is charged to the team owner's card. */
  teamCard: boolean;
  /** The monthly credit limit, and what is left of it; absent with no limit. */
  limit?: { limitCents: number; remainingCents: number };
  /** The last one-time charge was declined. */
  creditsDeclined: boolean;
  /** Absent when Auto-Reload is already on. */
  autoReload?: {
    minimumBalanceCents: number;
    targetBalanceCents: number;
    /** Dollars, as typed; blank means no limit. */
    monthlyLimit: string;
    /** The card on file could not be charged; offer to add a payment method. */
    paymentFailed: boolean;
  };
  pending: boolean;
  error?: string;
};

export type AiUsageLimitDialogProps = {
  open: boolean;
  code?: AiDenyCode;
  freePlan: boolean;
  /** When the monthly allowance resets. */
  resetsAt?: string;
  offer?: PurchaseOffer;
  previewNotice?: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onMode?: (mode: PurchaseMode) => void;
  onPack?: (cents: number) => void;
  onMonthlyLimit?: (value: string) => void;
  onBuyCredits?: () => void;
  onTurnOnAutoReload?: () => void;
  onAddPaymentMethod?: () => void;
};

function resetLabel(resetsAt: string | undefined) {
  const date = resetsAt ? new Date(resetsAt) : undefined;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : undefined;
}

function DetailRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
      <dt class="text-sm text-ink-muted">{props.label}</dt>
      <dd class="flex items-center text-right text-sm text-ink">
        {props.children}
      </dd>
    </div>
  );
}

export function AiUsageLimitDialogView(props: AiUsageLimitDialogProps) {
  const description = () => {
    const reset = resetLabel(props.resetsAt);
    if (props.freePlan) return 'Subscribe to a paid plan to keep going.';
    const keepGoing = props.offer
      ? 'Add credits to keep going now.'
      : 'Check your plan and usage options to keep going.';
    return reset ? `Your included AI resets ${reset}. ${keepGoing}` : keepGoing;
  };
  const autoReloadMode = () =>
    props.offer?.mode === 'auto-reload' ? props.offer.autoReload : undefined;
  const creditsMode = () =>
    props.offer?.mode === 'credits' ? props.offer : undefined;
  /** No pack fits in what is left of the monthly credit limit. */
  const limitReached = () => {
    const offer = creditsMode();
    return (
      !!offer?.limit &&
      offer.packsCents.every(
        (cents) => cents > (offer.limit?.remainingCents ?? 0)
      )
    );
  };
  /** A declined one-time charge the payer can fix with a new card. */
  const fixCard = () =>
    !!creditsMode()?.creditsDeclined && !props.offer?.teamCard;
  const error = () => {
    const offer = props.offer;
    if (offer?.error) return offer.error;
    if (autoReloadMode()?.paymentFailed)
      return "We couldn't charge your card. Add a payment method, then try again.";
    if (creditsMode()?.creditsDeclined)
      return offer?.teamCard
        ? "Your team's card was declined. Ask your team owner to update it."
        : 'Your card was declined. Add a payment method, then try again.';
    if (limitReached() && offer?.limit) {
      const limit = formatCreditBalance(offer.limit.limitCents);
      const reset = resetLabel(props.resetsAt);
      return offer.teamCard
        ? `Your team has used its ${limit} monthly credit limit${reset ? `. It resets ${reset}` : ''}. Ask your team owner to raise it.`
        : `You've used your ${limit} monthly credit limit. Raise it in usage settings.`;
    }
  };
  const primaryLabel = () => {
    const offer = props.offer;
    if (!offer) return props.freePlan ? 'View plans' : 'Open usage settings';
    if (offer.mode === 'credits') {
      if (fixCard()) return offer.pending ? 'Opening…' : 'Add payment method';
      return offer.pending
        ? 'Charging…'
        : `Buy ${formatCreditBalance(offer.packCents)} in credits`;
    }
    if (offer.autoReload?.paymentFailed)
      return offer.pending ? 'Opening…' : 'Add payment method';
    return offer.pending ? 'Turning on…' : 'Turn on auto-reload';
  };
  const onPrimary = () => {
    const offer = props.offer;
    if (!offer) return props.onOpenSettings();
    if (offer.mode === 'credits')
      return fixCard() ? props.onAddPaymentMethod?.() : props.onBuyCredits?.();
    if (offer.autoReload?.paymentFailed) return props.onAddPaymentMethod?.();
    props.onTurnOnAutoReload?.();
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      class="w-120"
    >
      <Surface depth={2} class="rounded-xl">
        <section class="flex flex-col font-sans">
          <header class="flex flex-col gap-1.5 p-6 pb-5">
            <Dialog.Title class="text-lg font-semibold text-ink">
              {TITLES[props.code ?? 'ai_allowance_exhausted']}
            </Dialog.Title>
            <Dialog.Description class="text-sm text-ink-muted">
              {description()}
            </Dialog.Description>
            <Show when={props.previewNotice}>
              <p class="text-xs text-ink-extra-muted" role="status">
                {props.previewNotice}
              </p>
            </Show>
          </header>

          <Show when={props.offer}>
            {(offer) => (
              <div class="flex flex-col gap-3 px-6 pb-6">
                <Show when={offer().autoReload}>
                  <Tabs
                    aria-label="How to add credits"
                    size="sm"
                    fullWidth
                    options={[
                      { value: 'credits', label: 'One-time' },
                      { value: 'auto-reload', label: 'Auto-reload' },
                    ]}
                    value={offer().mode}
                    onChange={(mode) => props.onMode?.(mode)}
                  />
                </Show>
                <dl class="divide-y divide-edge-muted rounded-lg border border-edge-muted">
                  <Switch>
                    <Match when={autoReloadMode()}>
                      {(reload) => (
                        <>
                          <DetailRow label="Reload">
                            {formatCreditBalance(reload().targetBalanceCents)}{' '}
                            when below{' '}
                            {formatCreditBalance(reload().minimumBalanceCents)}
                          </DetailRow>
                          <DetailRow label="Monthly limit">
                            <TextField
                              value={reload().monthlyLimit}
                              onChange={(value) =>
                                props.onMonthlyLimit?.(value)
                              }
                            >
                              <TextField.Label class="sr-only">
                                Monthly spend limit
                              </TextField.Label>
                              <InputGroup size="md" class="w-28">
                                <TextField.Input
                                  as={InputGroup.Input}
                                  inputMode="decimal"
                                  class="text-right text-sm"
                                  placeholder="None"
                                />
                                <InputGroup.Addon aria-hidden="true">
                                  $
                                </InputGroup.Addon>
                              </InputGroup>
                            </TextField>
                          </DetailRow>
                          <DetailRow label="Payment">Card on file</DetailRow>
                        </>
                      )}
                    </Match>
                    <Match when={offer().mode === 'credits'}>
                      <DetailRow label="Amount">
                        <Tabs
                          aria-label="Credit amount"
                          size="sm"
                          options={offer().packsCents.map((cents) => ({
                            value: String(cents),
                            label: formatCreditBalance(cents),
                            disabled:
                              offer().limit !== undefined &&
                              cents > (offer().limit?.remainingCents ?? 0),
                          }))}
                          value={String(offer().packCents)}
                          onChange={(cents) => props.onPack?.(Number(cents))}
                        />
                      </DetailRow>
                      <Show when={offer().limit}>
                        {(limit) => (
                          <DetailRow
                            label={
                              offer().teamCard
                                ? 'Team monthly limit'
                                : 'Monthly limit'
                            }
                          >
                            {formatCreditBalance(limit().remainingCents)} of{' '}
                            {formatCreditBalance(limit().limitCents)} left
                          </DetailRow>
                        )}
                      </Show>
                      <DetailRow label="Payment">
                        {offer().teamCard
                          ? "Team owner's card"
                          : 'Card on file'}
                      </DetailRow>
                    </Match>
                  </Switch>
                </dl>
                <p class="text-xs text-ink-extra-muted">
                  {autoReloadMode()
                    ? 'Leave the limit blank for no limit. Change or turn off auto-reload anytime in usage settings.'
                    : offer().teamCard
                      ? 'Credits are shared with your team and charged to its card right away.'
                      : 'Charged to your card right away. Credits are added immediately.'}
                </p>
                <Show when={error()}>
                  {(message) => (
                    <p class="text-sm text-failure-ink" role="alert">
                      {message()}
                    </p>
                  )}
                </Show>
              </div>
            )}
          </Show>

          <footer class="flex flex-col-reverse gap-2 border-t border-edge-muted px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Show
              when={props.offer}
              fallback={<span class="hidden sm:block" />}
            >
              <Button
                variant="ghost"
                class="sm:-ml-3"
                onClick={props.onOpenSettings}
              >
                Usage settings
              </Button>
            </Show>
            <div class="flex flex-col-reverse gap-2 sm:flex-row">
              <Button variant="ghost" onClick={props.onClose}>
                Dismiss
              </Button>
              <Button
                variant="neutral"
                disabled={
                  props.offer?.pending || (limitReached() && !fixCard())
                }
                onClick={onPrimary}
              >
                {primaryLabel()}
              </Button>
            </div>
          </footer>
        </section>
      </Surface>
    </Dialog>
  );
}

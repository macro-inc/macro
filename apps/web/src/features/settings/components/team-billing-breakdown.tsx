import { formatLocale, t } from '@app/lib/i18n';
import type {
  ComputerSize,
  SubscriptionBilling,
  SubscriptionBillingLineItem,
  TeamAgent,
} from '@service-auth/generated/schemas';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { formatBillingAmount } from '../core/format-billing-amount';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';

function sizeLabel(size: ComputerSize): string {
  return match(size)
    .with('standard', () => t('settingsBilling.standard'))
    .with('large', () => t('settingsBilling.large'))
    .with('xl', () => t('settingsBilling.xl'))
    .exhaustive((unknown) => String(unknown));
}

function computerStatus(status: string | null | undefined): string {
  return match(status)
    .with('running', 'ready', () => t('settingsBilling.running'))
    .with('provisioning', 'setting_up', () => t('settingsBilling.settingUp'))
    .with('failed', 'payment_failed', () => t('settingsBilling.failed'))
    .with('unhealthy', () => t('settingsBilling.unhealthy'))
    .with('asleep', () => t('settingsBilling.asleep'))
    .with('waking', () => t('settingsBilling.waking'))
    .with('stopping', () => t('settingsBilling.stopping'))
    .with('stopped', () => t('settingsBilling.stopped'))
    .with('released', () => t('settingsBilling.released'))
    .otherwise(() => t('settingsBilling.statusUnavailable'));
}

/** Current subscription amounts, never an estimate from catalog prices. */
export function TeamBillingBreakdown(props: {
  billing: SubscriptionBilling;
  agents: readonly TeamAgent[];
}) {
  const money = (amount: number) =>
    formatBillingAmount(amount, props.billing.currency, formatLocale());
  const interval = () =>
    t(
      props.billing.interval === 'month'
        ? 'settingsBilling.month'
        : 'settingsBilling.year'
    );
  const computerLines = () =>
    props.billing.lineItems.filter((line) => line.kind === 'computer');
  const otherLines = () =>
    props.billing.lineItems.filter((line) => line.kind === 'other');
  const agentForLine = (line: SubscriptionBillingLineItem) =>
    props.agents.find(
      (agent) =>
        agent.userId === line.agentUserId ||
        (!!line.computerId && agent.computerId === line.computerId)
    );
  const status = (line: SubscriptionBillingLineItem) =>
    agentForLine(line)?.status ?? line.status;
  const lineAmount = (line: SubscriptionBillingLineItem) =>
    line.included ? t('settingsBilling.included') : money(line.amount);
  const invoiceDate = () => {
    const value = props.billing.nextInvoice?.date;
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? undefined
      : date.toLocaleDateString(formatLocale(), {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
  };
  return (
    <SettingsSection
      title={t('settingsBilling.breakdown')}
      description={t('settingsBilling.currentSubscription', {
        interval: interval(),
      })}
      target="subscription-breakdown"
    >
      <SettingsCard>
        {/* Billing keeps two columns even when sheet settings rows wrap controls. */}
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto]"
          label={t('settingsBilling.humanSeats')}
          description={t('settingsBilling.paidSeats', {
            count: props.billing.humanSeats.quantity,
          })}
        >
          <span class="text-sm tabular-nums">
            {money(props.billing.humanSeats.amount)}
          </span>
        </SettingsRow>
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto]"
          label={t('settingsBilling.agentSeats')}
          description={t('settingsBilling.paidSeats', {
            count: props.billing.agentSeats.quantity,
          })}
        >
          <span class="text-sm tabular-nums">
            {money(props.billing.agentSeats.amount)}
          </span>
        </SettingsRow>
        <Show when={computerLines().length > 0}>
          <SettingsRow
            class="grid! grid-cols-[minmax(0,1fr)_auto]"
            label={t('settingsBilling.computers')}
            description={t('settingsBilling.computerCount', {
              count: computerLines().reduce(
                (quantity, line) => quantity + line.quantity,
                0
              ),
            })}
          >
            <span class="text-sm tabular-nums">
              {money(
                computerLines().reduce(
                  (amount, line) => amount + line.amount,
                  0
                )
              )}
            </span>
          </SettingsRow>
        </Show>
        <For each={computerLines()}>
          {(line) => (
            <SettingsRow
              class="grid! grid-cols-[minmax(0,1fr)_auto]"
              label={
                <span class="break-words">
                  {line.size
                    ? t('settingsBilling.computerName', {
                        name: agentForLine(line)?.name ?? line.name,
                        size: sizeLabel(line.size),
                      })
                    : (agentForLine(line)?.name ?? line.name)}
                </span>
              }
              description={
                line.size
                  ? t('settingsBilling.sizedComputer', {
                      size: sizeLabel(line.size),
                    })
                  : t('settingsBilling.computer')
              }
            >
              <div class="flex max-w-48 flex-col items-end gap-1 text-right text-sm sm:flex-row sm:items-center sm:gap-2">
                <span
                  class="rounded-full bg-ink/6 px-2 py-1 text-xs"
                  classList={{
                    'text-failure':
                      status(line) === 'failed' ||
                      status(line) === 'unhealthy' ||
                      status(line) === 'payment_failed',
                    'text-success':
                      status(line) === 'ready' || status(line) === 'running',
                  }}
                >
                  {computerStatus(status(line))}
                </span>
                <span class="tabular-nums">{lineAmount(line)}</span>
              </div>
            </SettingsRow>
          )}
        </For>
        <For each={otherLines()}>
          {(line) => (
            <SettingsRow
              class="grid! grid-cols-[minmax(0,1fr)_auto]"
              label={<span class="break-words">{line.name}</span>}
              description={
                line.unitAmount != null
                  ? t('settingsBilling.unitPrice', {
                      count: line.quantity,
                      amount: money(line.unitAmount),
                      interval: interval(),
                    })
                  : t('settingsBilling.items', { count: line.quantity })
              }
            >
              <span class="text-sm tabular-nums">{lineAmount(line)}</span>
            </SettingsRow>
          )}
        </For>
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto]"
          label={t('settingsBilling.total', { interval: interval() })}
        >
          <strong class="text-sm tabular-nums">
            {money(props.billing.subscriptionTotal)}
          </strong>
        </SettingsRow>
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto]"
          label={t('settingsBilling.nextInvoice')}
          description={
            invoiceDate() ??
            t(
              props.billing.nextInvoice
                ? 'settingsBilling.dateUnavailable'
                : 'settingsBilling.noInvoice'
            )
          }
        >
          <Show when={props.billing.nextInvoice}>
            {(invoice) => (
              <span class="text-sm tabular-nums">
                {money(invoice().amount)}
              </span>
            )}
          </Show>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}

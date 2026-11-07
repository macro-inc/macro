import { formatLocale, t } from '@app/lib/i18n';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import type {
  ComputerSize,
  SubscriptionBilling,
  SubscriptionBillingLineItem,
  TeamAgent,
} from '@service-auth/generated/schemas';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { computerSpecs, formatQuote } from '../computers/core/computer-display';
import { formatBillingAmount } from '../core/format-billing-amount';
import { SettingsCard, SettingsRow, SettingsSection } from '../primitives';
import { PriceBreakdown, type PriceBreakdownItem } from './price-breakdown';

function sizeLabel(size: ComputerSize): string {
  return match(size)
    .with('standard', () => t('settingsBilling.standard'))
    .with('large', () => t('settingsBilling.large'))
    .with('xl', () => t('settingsBilling.xl'))
    .exhaustive((unknown) => String(unknown));
}

function computerStatus(status: string | null | undefined): string {
  return match(status)
    .with('running', 'ready', () => t('settingsBilling.alive'))
    .with('provisioning', 'setting_up', () => t('settingsBilling.settingUp'))
    .with('failed', 'payment_failed', () => t('settingsBilling.failed'))
    .with('unhealthy', () => t('settingsBilling.dead'))
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
  computers?: readonly ComputerStatus[];
  offers?: readonly SizeOffer[];
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
  const allIncluded = () =>
    props.billing.subscriptionTotal === 0 &&
    props.billing.humanSeats.amount === 0 &&
    props.billing.agentSeats.amount === 0 &&
    props.billing.lineItems.length > 0 &&
    props.billing.lineItems.every((line) => line.included);
  const items = (): PriceBreakdownItem[] => [
    {
      name: t('settingsBilling.humanSeats'),
      description: t('settingsBilling.paidSeats', {
        count: props.billing.humanSeats.quantity,
      }),
      amount: props.billing.humanSeats.amount,
      included: allIncluded(),
    },
    {
      name: t('settingsBilling.agentSeats'),
      description: t('settingsBilling.paidSeats', {
        count: props.billing.agentSeats.quantity,
      }),
      amount: props.billing.agentSeats.amount,
      included: allIncluded(),
    },
    ...computerLines().map((line) => {
      const computer = props.computers?.find(
        (item) => item.id === line.computerId
      );
      const offer = props.offers?.find((item) => item.size === line.size);
      const catalogDiffers =
        offer &&
        !line.included &&
        line.unitAmount != null &&
        offer.quote.currency.toLowerCase() ===
          props.billing.currency.toLowerCase() &&
        offer.quote.interval === props.billing.interval &&
        offer.quote.amount !== line.unitAmount;
      return {
        name: line.size
          ? t('settingsBilling.computerName', {
              name: agentForLine(line)?.name ?? line.name,
              size: sizeLabel(line.size),
            })
          : (agentForLine(line)?.name ?? line.name),
        description: (
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {computer
                ? computerSpecs(computer)
                : line.size
                  ? t('settingsBilling.sizedComputer', {
                      size: sizeLabel(line.size),
                    })
                  : t('settingsBilling.computer')}
            </span>
            <span
              class="rounded-full bg-ink/6 px-2 py-1 text-xs"
              classList={{
                'text-failure': [
                  'failed',
                  'unhealthy',
                  'payment_failed',
                ].includes(status(line) ?? ''),
                'text-success': ['ready', 'running'].includes(
                  status(line) ?? ''
                ),
              }}
            >
              {computerStatus(status(line))}
            </span>
            <Show when={catalogDiffers && offer}>
              {(current) => (
                <span class="basis-full text-xs">
                  {t('settingsBilling.catalogPrice', {
                    price: formatQuote(current().quote),
                  })}
                </span>
              )}
            </Show>
          </div>
        ),
        amount: line.amount,
        included: line.included,
      };
    }),
    ...otherLines().map((line) => ({
      name: line.name,
      description:
        line.unitAmount != null
          ? t('settingsBilling.unitPrice', {
              count: line.quantity,
              amount: money(line.unitAmount),
              interval: interval(),
            })
          : t('settingsBilling.items', { count: line.quantity }),
      amount: line.amount,
      included: line.included,
    })),
  ];
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
      <SettingsCard class="px-4">
        <PriceBreakdown
          items={items()}
          currency={props.billing.currency}
          interval={props.billing.interval}
          total={props.billing.subscriptionTotal}
          included={allIncluded()}
          note={t('settingsBilling.invoiceNote')}
        />
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto] px-0"
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

import { formatLocale, t } from '@app/lib/i18n';
import type { BillingInterval } from '@service-auth/generated/schemas';
import { For, type JSX, Show } from 'solid-js';
import { formatBillingAmount } from '../core/format-billing-amount';
import { SettingsRow } from '../primitives';

export type PriceBreakdownItem = {
  name: JSX.Element;
  description?: JSX.Element;
  amount: number;
  included?: boolean;
};

/** The same recurring-price layout for purchase reviews and actual subscriptions. */
export function PriceBreakdown(props: {
  items: readonly PriceBreakdownItem[];
  currency: string;
  interval: BillingInterval;
  total: number;
  included?: boolean;
  /** Billing uses invoice-specific copy instead of purchase proration. */
  note?: JSX.Element;
}) {
  const amount = (value: number) =>
    formatBillingAmount(value, props.currency, formatLocale());
  const interval = () =>
    t(
      props.interval === 'year'
        ? 'settingsBilling.year'
        : 'settingsBilling.month'
    );
  return (
    <div aria-label={t('settingsBilling.priceBreakdown')}>
      <For each={props.items}>
        {(item) => (
          <SettingsRow
            class="grid! grid-cols-[minmax(0,1fr)_auto] gap-3 px-0 py-2 min-h-0"
            label={<span class="break-words text-sm">{item.name}</span>}
            description={item.description}
          >
            <span class="whitespace-nowrap text-sm tabular-nums">
              {item.included ? t('computers.included') : amount(item.amount)}
            </span>
          </SettingsRow>
        )}
      </For>
      <div class="mt-2 border-t border-edge-divider pt-2">
        <SettingsRow
          class="grid! grid-cols-[minmax(0,1fr)_auto] gap-3 px-0 py-2 min-h-0"
          label={
            <strong class="text-sm">
              {t('settingsBilling.total', { interval: interval() })}
            </strong>
          }
        >
          <strong class="whitespace-nowrap text-sm tabular-nums">
            {props.included ? t('computers.included') : amount(props.total)}
          </strong>
        </SettingsRow>
      </div>
      <Show when={props.included || props.items.some((item) => item.included)}>
        <p class="mt-2 text-sm text-ink-muted">
          {t('settingsBilling.included')}
        </p>
      </Show>
      <p class="mt-2 text-sm leading-relaxed text-ink-muted">
        {props.note ??
          (props.included
            ? t('settingsBilling.noCharge')
            : t('settingsBilling.proration'))}
      </p>
    </div>
  );
}

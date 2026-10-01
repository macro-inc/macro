import CheckIcon from '@phosphor/check.svg';
import MinusIcon from '@phosphor/minus.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createSignal, For, Show } from 'solid-js';
import {
  formatWholeUsd,
  SALES_DEFAULT_SEATS,
  SALES_DEFAULT_TIER,
  SALES_HEADLINE_TOOLS,
  type SalesTier,
  salesSavings,
  tierMonthlyCents,
  tierPlan,
} from '../../core/sales-savings';
import {
  MAX_SEATS,
  PRICES_CHECKED,
  parseSeats,
  SAVINGS_TOOLS,
  type SavingsToolId,
} from '../../core/savings-calculator';
import { toolIcons } from '../pricing/SavingsCalculator';
import './sales-calculator.css';

const TIERS: readonly { id: SalesTier; label: string }[] = [
  { id: 'starter', label: 'Cheapest plans' },
  { id: 'business', label: 'Business plans' },
];

/** Thumb-sized version of the pricing calculator for the ad landing page. */
export function SalesCalculator(props: { onBook: () => void }) {
  const [seats, setSeats] = createSignal(SALES_DEFAULT_SEATS);
  const [tier, setTier] = createSignal<SalesTier>(SALES_DEFAULT_TIER);
  const [selected, setSelected] =
    createSignal<readonly SavingsToolId[]>(SALES_HEADLINE_TOOLS);
  const result = () => salesSavings(selected(), seats(), tier());
  const isSelected = (id: SavingsToolId) => selected().includes(id);
  const toggle = (id: SavingsToolId) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  const stepSeats = (delta: number) =>
    setSeats((count) => parseSeats(String(count + delta)) ?? count);

  return (
    <div class="sales-calc">
      <div class="sales-calc-controls glass">
        <div class="sales-calc-row">
          <span id="sales-calc-seats-label" class="sales-calc-label">
            People on your team
          </span>
          <div class="sales-calc-stepper">
            <button
              type="button"
              aria-label="Remove a person"
              disabled={seats() <= 1}
              onClick={() => stepSeats(-1)}
            >
              <MinusIcon aria-hidden="true" />
            </button>
            <input
              type="number"
              inputmode="numeric"
              min="1"
              max={MAX_SEATS}
              value={seats()}
              aria-labelledby="sales-calc-seats-label"
              onInput={(event) => {
                const next = parseSeats(event.currentTarget.value);
                if (next !== null) setSeats(next);
              }}
              onBlur={(event) => {
                event.currentTarget.value = String(seats());
              }}
            />
            <button
              type="button"
              aria-label="Add a person"
              disabled={seats() >= MAX_SEATS}
              onClick={() => stepSeats(1)}
            >
              <PlusIcon aria-hidden="true" />
            </button>
          </div>
        </div>
        <div
          class="sales-calc-tiers"
          role="group"
          aria-label="Plan you pay for"
        >
          <For each={TIERS}>
            {(option) => (
              <button
                type="button"
                aria-pressed={tier() === option.id}
                onClick={() => setTier(option.id)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
        <p class="sales-calc-label">Tap everything you pay for</p>
        <ul class="sales-calc-tools" aria-label="Tools you pay for">
          <For each={SAVINGS_TOOLS}>
            {(tool) => {
              const Icon = toolIcons[tool.id];
              return (
                <li>
                  <button
                    type="button"
                    aria-pressed={isSelected(tool.id)}
                    aria-label={`${tool.name} ${tierPlan(tool, tier()).name}`}
                    onClick={() => toggle(tool.id)}
                  >
                    <span class="sales-calc-check" aria-hidden="true">
                      <CheckIcon />
                    </span>
                    <Icon class="sales-calc-icon" aria-hidden="true" />
                    <span class="sales-calc-name">{tool.name}</span>
                    <span class="sales-calc-price">
                      {formatWholeUsd(tierMonthlyCents(tool, tier()))}
                    </span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </div>
      <div class="sales-calc-result glass" aria-live="polite">
        <div class="sales-calc-lines">
          <p>
            <span>What you pay now</span>
            <s>{formatWholeUsd(result().toolsCents)}/yr</s>
          </p>
          <p>
            <span>Macro</span>
            <strong>{formatWholeUsd(result().macroCents)}/yr</strong>
          </p>
        </div>
        <Show
          when={result().savedCents > 0}
          fallback={
            <p class="sales-calc-even">
              Macro replaces all of it for{' '}
              {formatWholeUsd(result().macroCents / seats() / 12)} a person per
              month.
            </p>
          }
        >
          <p class="sales-calc-saved">
            <span>You save</span>
            <strong>{formatWholeUsd(result().savedCents)}</strong>
            <span>every year</span>
          </p>
        </Show>
        <button
          type="button"
          class="site-nav-start homepage-hero-cta"
          onClick={() => props.onBook()}
        >
          Book a demo
        </button>
      </div>
      <p class="sales-calc-note">
        Monthly per-seat prices, billed yearly, from each tool’s pricing page in{' '}
        {PRICES_CHECKED}. Macro is $40 a seat per month for your first 5 seats,
        then $80.
      </p>
    </div>
  );
}

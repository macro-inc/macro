import AsanaIcon from '@assets/icons/logo-asana.svg';
import attioLogo from '@assets/icons/logo-attio.ico';
import ClickUpIcon from '@assets/icons/logo-clickup.svg';
import JiraIcon from '@assets/icons/logo-jira.svg';
import LinearIcon from '@icon/mcp-linear.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/mcp-slack.svg';
import CalendlyIcon from '@icon/onboarding-calendly.svg';
import HubSpotIcon from '@icon/onboarding-hubspot.svg';
import SuperhumanIcon from '@icon/onboarding-superhuman.svg';
import CheckIcon from '@icon/system/regular/check.svg';
// The site has no Salesforce mark; a neutral cloud stands in for it.
import SalesforceIcon from '@icon/system/regular/cloud.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import {
  createSignal,
  createUniqueId,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { additionalAppCosts } from '../../core/replacement-app-costs';
import {
  annualPlanPrice,
  formatUsd,
  initialChoices,
  MAX_SEATS,
  PRICES_CHECKED,
  parseSeats,
  SAVINGS_TOOLS,
  type SavingsToolId,
  summarizeSavings,
} from '../../core/savings-calculator';
import {
  type ReplacementApp,
  ReplacementAppIcon,
} from '../product/ReplacementAppIcon';
import './savings-calculator.css';

export const toolIcons: Record<
  SavingsToolId,
  (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element
> = {
  notion: NotionIcon,
  linear: LinearIcon,
  jira: JiraIcon,
  asana: AsanaIcon,
  clickup: ClickUpIcon,
  hubspot: HubSpotIcon,
  salesforce: SalesforceIcon,
  slack: SlackIcon,
  superhuman: SuperhumanIcon,
};

/** Yearly cost of a team's current tools next to Rox's paid plan. */
export function SavingsCalculator(
  props: { apps?: readonly ReplacementApp[] } = {}
) {
  const [choices, setChoices] = createStore(
    initialChoices(props.apps ? 'higher' : 'entry')
  );
  const [seats, setSeats] = createSignal(5);
  const [additionalSelections, setAdditionalSelections] = createStore<
    Record<string, boolean>
  >({});
  const summary = () =>
    summarizeSavings(
      choices,
      seats(),
      additionalAppCosts(
        Object.keys(additionalSelections).filter(
          (name) => additionalSelections[name]
        )
      )
    );
  let appRow: HTMLUListElement | undefined;
  const appRowId = createUniqueId();
  const [scrollPosition, setScrollPosition] = createSignal(0);
  const [scrollLimit, setScrollLimit] = createSignal(0);
  const syncScroll = () => {
    if (!appRow) return;
    setScrollLimit(Math.max(0, appRow.scrollWidth - appRow.clientWidth));
    setScrollPosition(appRow.scrollLeft);
  };
  const moveScroll = (direction: number) => {
    if (appRow) appRow.scrollBy({ left: direction * appRow.clientWidth * 0.7 });
  };
  onMount(() => {
    if (!appRow) return;
    const observer = new ResizeObserver(syncScroll);
    observer.observe(appRow);
    syncScroll();
    onCleanup(() => observer.disconnect());
  });
  const savings = () => summary().toolsCents - summary().macroCents;
  const stepSeats = (delta: number) =>
    setSeats((count) => parseSeats(String(count + delta)) ?? count);
  // Picking a plan implies the visitor pays for that tool.
  const choosePlan = (id: SavingsToolId, planId: string) =>
    setChoices(id, { selected: true, planId });

  return (
    <div
      class="pricing-savings"
      classList={{ 'pricing-savings--app-grid': Boolean(props.apps) }}
    >
      <div class="pricing-savings-body">
        <Show
          when={props.apps}
          fallback={
            <ul class="pricing-savings-tools" aria-label="Tools you pay for">
              <For each={SAVINGS_TOOLS}>
                {(tool) => {
                  const Icon = toolIcons[tool.id];
                  const choice = () => choices[tool.id];
                  return (
                    <li data-selected={choice().selected}>
                      <button
                        type="button"
                        class="pricing-savings-toggle"
                        aria-pressed={choice().selected}
                        onClick={() =>
                          setChoices(
                            tool.id,
                            'selected',
                            (selected) => !selected
                          )
                        }
                      >
                        <span class="pricing-savings-check" aria-hidden="true">
                          <CheckIcon />
                        </span>
                        <Icon class="pricing-savings-icon" aria-hidden="true" />
                        <span class="pricing-savings-name">{tool.name}</span>
                      </button>
                      <div
                        class="pricing-savings-plans"
                        role="group"
                        aria-label={`${tool.name} plan`}
                      >
                        <For each={tool.plans}>
                          {(plan) => (
                            <button
                              type="button"
                              aria-pressed={
                                choice().selected && choice().planId === plan.id
                              }
                              onClick={() => choosePlan(tool.id, plan.id)}
                            >
                              {plan.name}
                            </button>
                          )}
                        </For>
                      </div>
                      <span class="pricing-savings-price">
                        {formatUsd(annualPlanPrice(tool, choice().planId))}
                        <span>/seat/yr</span>
                      </span>
                    </li>
                  );
                }}
              </For>
            </ul>
          }
        >
          {(apps) => (
            <div class="replacement-app-picker">
              <ul
                ref={appRow}
                id={appRowId}
                class="replacement-app-grid"
                aria-label="Tools you pay for"
                onScroll={syncScroll}
              >
                <For each={apps()}>
                  {(name) => {
                    const tool = SAVINGS_TOOLS.find(
                      (entry) => entry.name === name
                    );
                    const selected = () =>
                      tool
                        ? choices[tool.id].selected
                        : Boolean(additionalSelections[name]);
                    return (
                      <li data-selected={selected()}>
                        <button
                          type="button"
                          class="replacement-app-toggle"
                          aria-pressed={selected()}
                          aria-label={name}
                          onClick={() =>
                            tool
                              ? setChoices(
                                  tool.id,
                                  'selected',
                                  (value) => !value
                                )
                              : setAdditionalSelections(name, !selected())
                          }
                        >
                          <span class="replacement-app-tile" aria-hidden="true">
                            <ReplacementAppIcon name={name} />
                            <span class="replacement-app-check">
                              <Show when={selected()} fallback={<PlusIcon />}>
                                <CheckIcon />
                              </Show>
                            </span>
                          </span>
                          <span class="replacement-app-name">{name}</span>
                        </button>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <div class="replacement-scroll-controls">
                <button
                  type="button"
                  aria-label="Scroll apps left"
                  aria-controls={appRowId}
                  disabled={scrollPosition() <= 1}
                  onClick={() => moveScroll(-1)}
                >
                  ←
                </button>
                <input
                  class="replacement-scroll-range"
                  type="range"
                  min="0"
                  max={scrollLimit()}
                  step="1"
                  value={scrollPosition()}
                  disabled={scrollLimit() === 0}
                  aria-label="Scroll through apps"
                  aria-controls={appRowId}
                  aria-valuetext={`${Math.round(scrollLimit() ? (scrollPosition() / scrollLimit()) * 100 : 0)}% through apps`}
                  onInput={(event) =>
                    appRow?.scrollTo({
                      left: event.currentTarget.valueAsNumber,
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Scroll apps right"
                  aria-controls={appRowId}
                  disabled={scrollPosition() >= scrollLimit() - 1}
                  onClick={() => moveScroll(1)}
                >
                  →
                </button>
              </div>
            </div>
          )}
        </Show>
        <aside class="pricing-savings-summary">
          <Show when={props.apps}>
            <div class="replacement-ledger-row replacement-subtotal">
              <span>Selected apps / seat</span>
              <span aria-live="polite">
                {formatUsd(summary().toolsCents / seats() / 12)}
                <small> / month</small>
              </span>
            </div>
          </Show>
          <div class="pricing-savings-seats">
            <span id="pricing-savings-seats-label">Seats</span>
            <div class="pricing-savings-stepper">
              <button
                type="button"
                aria-label="Remove a seat"
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
                aria-labelledby="pricing-savings-seats-label"
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
                aria-label="Add a seat"
                disabled={seats() >= MAX_SEATS}
                onClick={() => stepSeats(1)}
              >
                <PlusIcon aria-hidden="true" />
              </button>
            </div>
            <Show when={props.apps}>
              <span class="replacement-annual-cost" aria-live="polite">
                {formatUsd(summary().toolsCents)}
                <small> / year</small>
              </span>
            </Show>
          </div>
          <Show
            when={props.apps}
            fallback={
              <>
                <div class="pricing-savings-result" aria-live="polite">
                  <span>Your current stack</span>
                  <strong>{formatUsd(summary().toolsCents)}</strong>
                  <span>
                    per year for {seats()} {seats() === 1 ? 'seat' : 'seats'}
                  </span>
                </div>
                <div class="pricing-savings-macro" aria-live="polite">
                  <span>Rox</span>
                  <span>{formatUsd(summary().macroCents)} per year</span>
                </div>
              </>
            }
          >
            <div class="replacement-ledger-row">
              <span>Rox cost</span>
              <span aria-live="polite">
                {formatUsd(summary().macroCents)}
                <small> / year</small>
              </span>
            </div>
            <div class="replacement-ledger-row replacement-savings">
              <span>
                {savings() >= 0
                  ? 'Estimated savings'
                  : 'Additional cost with Rox'}
              </span>
              <span class="replacement-ledger-total" aria-live="polite">
                {formatUsd(Math.abs(savings()))}
                <small> / year</small>
              </span>
            </div>
          </Show>
        </aside>
      </div>
      <p class="pricing-savings-note">
        <Show
          when={props.apps}
          fallback={
            <>
              Yearly totals use 12 months at the lowest per-seat price on each
              tool’s pricing page in {PRICES_CHECKED}.
            </>
          }
        >
          Estimates use published plans and count bundled apps once.
        </Show>{' '}
        Rox Pro is $40 per seat per month.
      </p>
    </div>
  );
}

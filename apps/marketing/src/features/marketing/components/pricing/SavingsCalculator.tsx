import AsanaIcon from '@assets/icons/logo-asana.svg';
import ClickUpIcon from '@assets/icons/logo-clickup.svg';
import JiraIcon from '@assets/icons/logo-jira.svg';
import LinearIcon from '@icon/mcp-linear.svg';
import NotionIcon from '@icon/mcp-notion.svg';
import SlackIcon from '@icon/mcp-slack.svg';
import HubSpotIcon from '@icon/onboarding-hubspot.svg';
import SuperhumanIcon from '@icon/onboarding-superhuman.svg';
import CheckIcon from '@phosphor/check.svg';
// The site has no Salesforce mark; a neutral cloud stands in for it.
import SalesforceIcon from '@phosphor/cloud.svg';
import MinusIcon from '@phosphor/minus.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createSignal, For, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
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

/** Yearly cost of a team's current tools next to Macro's paid plan. */
export function SavingsCalculator() {
  const [choices, setChoices] = createStore(initialChoices());
  const [seats, setSeats] = createSignal(5);
  const summary = () => summarizeSavings(choices, seats());
  const stepSeats = (delta: number) =>
    setSeats((count) => parseSeats(String(count + delta)) ?? count);
  // Picking a plan implies the visitor pays for that tool.
  const choosePlan = (id: SavingsToolId, planId: string) =>
    setChoices(id, { selected: true, planId });

  return (
    <div class="pricing-savings">
      <div class="pricing-savings-body">
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
                      setChoices(tool.id, 'selected', (selected) => !selected)
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
        <aside class="pricing-savings-summary">
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
          </div>
          <div class="pricing-savings-result" aria-live="polite">
            <span>Your current stack</span>
            <strong>{formatUsd(summary().toolsCents)}</strong>
            <span>
              per year for {seats()} {seats() === 1 ? 'seat' : 'seats'}
            </span>
          </div>
          <div class="pricing-savings-macro" aria-live="polite">
            <span>Macro</span>
            <span>{formatUsd(summary().macroCents)} per year</span>
          </div>
        </aside>
      </div>
      <p class="pricing-savings-note">
        Yearly totals use 12 months at the lowest per-seat price on each tool’s
        pricing page in {PRICES_CHECKED}. Macro’s paid plan is $40 per seat a
        month for your first 5 seats, then $80.
      </p>
    </div>
  );
}

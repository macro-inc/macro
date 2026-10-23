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
import { createSignal, For, type JSX, Show } from 'solid-js';
import {
  COMPARISON_GROUPS,
  DEFAULT_COMPARISON_TOOLS,
  MORE_COMPARISON_TOOLS,
  summarizeComparison,
} from '../../core/pricing-comparison';
import {
  formatUsd,
  MAX_SEATS,
  parseSeats,
  type SavingsToolId,
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
  const [selected, setSelected] = createSignal(DEFAULT_COMPARISON_TOOLS);
  const [showMore, setShowMore] = createSignal(false);
  const [seats, setSeats] = createSignal(5);
  const summary = () => summarizeComparison(selected(), seats());
  const stepSeats = (delta: number) =>
    setSeats((count) => parseSeats(String(count + delta)) ?? count);
  const toggleTool = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );

  return (
    <div class="pricing-savings">
      <div class="pricing-savings-body">
        <div class="pricing-savings-groups" id="pricing-savings-groups">
          <For each={COMPARISON_GROUPS}>
            {(group) => (
              <section class="pricing-savings-group" aria-label={group.name}>
                <h3>{group.name}</h3>
                <ul class="pricing-savings-tools">
                  <For each={group.tools.filter((tool) => showMore() || !MORE_COMPARISON_TOOLS.includes(tool.id))}>
                    {(tool) => (
                      <li data-selected={selected().includes(tool.id)}>
                        <button
                          type="button"
                          class="pricing-savings-toggle"
                          aria-label={`${tool.name} ${tool.plan.name}`}
                          aria-pressed={selected().includes(tool.id)}
                          onClick={() => toggleTool(tool.id)}
                        >
                          <span
                            class="pricing-savings-check"
                            aria-hidden="true"
                          >
                            <CheckIcon />
                          </span>
                          <span class="pricing-savings-tool-label">
                            <span class="pricing-savings-name">
                              {tool.name}
                            </span>
                            <span class="pricing-savings-plan">
                              {tool.plan.name}
                            </span>
                          </span>
                        </button>
                        <a
                          class="pricing-savings-price"
                          href={tool.source}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${tool.name} pricing: ${formatUsd(tool.plan.monthlyCents)} per user per month`}
                        >
                          {formatUsd(tool.plan.monthlyCents)}
                          <span>/user/mo</span>
                        </a>
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            )}
          </For>
          <button
            type="button"
            class="pricing-savings-more"
            aria-expanded={showMore()}
            aria-controls="pricing-savings-groups"
            onClick={() => setShowMore((value) => !value)}
          >
            {showMore() ? 'Show fewer tools' : 'Show more tools'}
            <span aria-hidden="true">{showMore() ? '−' : '+'}</span>
          </button>
        </div>
        <aside class="pricing-savings-summary">
          <div class="pricing-savings-seats">
            <span id="pricing-savings-seats-label">People on your team</span>
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
            <span>
              {summary().differenceCents > 0
                ? 'You’d save'
                : summary().differenceCents < 0
                  ? 'Macro would cost more'
                  : 'Same yearly cost'}
            </span>
            <strong>{formatUsd(Math.abs(summary().differenceCents))}</strong>
            <span>
              per year for {seats()} {seats() === 1 ? 'person' : 'people'}
            </span>
          </div>
          <div class="pricing-savings-macro-plan">
            <span>With Macro Pro</span>
            <strong>
              $40<span>/user/month</span>
            </strong>
          </div>
        </aside>
      </div>
      <Show when={showMore()}>
        <p class="pricing-savings-note">
          USD list prices for the plans shown, generally billed annually. Jira
          uses its published monthly rate; Acrobat uses an annual contract
          billed monthly. Estimates assume every person has each selected tool.
          Seat minimums, usage limits, features, and storage differ; this
          compares subscription costs. Keep your email provider. Click a price
          to see its source.
        </p>
      </Show>
    </div>
  );
}

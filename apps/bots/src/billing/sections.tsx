import { createMemo, For, Show } from 'solid-js';
import type {
  BillingReading,
  ModeledSpend,
  RecurringInvoice,
  StartedHourUsage,
} from './read';
import { ReadState } from './read-state';
import { dateRange, formatDate, money, summarizeUsage } from './usage';

const usageMessages = {
  pending: 'Started-hour usage is pending.',
  denied: 'You don’t have access to started-hour usage.',
  empty: 'No started-hour observations in this window.',
  unavailable: 'Started-hour usage is unavailable.',
};

function UsageSummary(props: {
  usage: StartedHourUsage;
  summary: NonNullable<ReturnType<typeof summarizeUsage>>;
}) {
  const summary = () => props.summary;
  const unbilled = () => {
    const billed = props.usage.billedMinor;
    return (
      props.usage.cycle.status === 'open' &&
      billed.status === 'ready' &&
      billed.value === 0
    );
  };
  const amount = (minor: number) => money(minor, props.usage.currency);
  const window = () =>
    dateRange(props.usage.cycle.start, props.usage.observedThrough);

  return (
    <>
      <div class="billing-summary">
        <div class="billing-amount">
          <p>
            Current cycle ·{' '}
            {dateRange(props.usage.cycle.start, props.usage.cycle.end)}
          </p>
          <h2>Agent work · {window()}</h2>
          <div class="billing-totals">
            <div>
              <strong class="billing-estimate">
                {amount(summary().estimateMinor)}
              </strong>
              <span>
                {unbilled() ? 'Estimated (unbilled)' : 'Estimated charge'}
              </span>
            </div>
            <div>
              <ReadState
                result={props.usage.billedMinor}
                messages={{
                  pending: 'Billed amount pending.',
                  denied: 'Billed amount restricted.',
                  empty: 'No billed amount reported.',
                  unavailable: 'Billed amount unavailable.',
                }}
              >
                {(minor) => (
                  <>
                    <strong>{amount(minor())}</strong>
                    <span>Billed · cycle {props.usage.cycle.status}</span>
                  </>
                )}
              </ReadState>
            </div>
          </div>
          <p>
            {summary().hours} estimated started hours across{' '}
            {summary().agents.length} agents.
          </p>
        </div>
        <div class="billing-trend">
          <div class="billing-trend-caption">
            <span>Daily started hours</span>
            <span>
              {summary().hours}h est. · peak {summary().peak}h/day
            </span>
          </div>
          <div class="billing-bars" aria-hidden="true">
            <For each={summary().days}>
              {(day) => (
                <span
                  classList={{ 'billing-bar-empty': day.hours === 0 }}
                  style={{
                    height: `${summary().peak ? (day.hours / summary().peak) * 100 : 0}%`,
                  }}
                />
              )}
            </For>
          </div>
          <div class="billing-trend-caption" aria-hidden="true">
            <span>{summary().days[0]?.label}</span>
            <span>
              {summary().days[Math.floor(summary().days.length / 2)]?.label}
            </span>
            <span>{summary().days.at(-1)?.label}</span>
          </div>
          <details>
            <summary>Daily values</summary>
            <dl class="billing-days">
              <For each={summary().days}>
                {(day) => (
                  <div>
                    <dt>{day.label}</dt>
                    <dd>{day.hours}h</dd>
                  </div>
                )}
              </For>
            </dl>
          </details>
        </div>
      </div>
      <section
        class="billing-panel billing-ledger"
        aria-labelledby="billing-ledger-title"
      >
        <header>
          <h2 id="billing-ledger-title">Usage ledger</h2>
          <span>{window()}</span>
        </header>
        <table aria-labelledby="billing-ledger-title">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th class="billing-meter" scope="col">
                Meter
              </th>
              <th scope="col">Est. hours</th>
              <th scope="col">Rate</th>
              <th scope="col">Est. charge</th>
            </tr>
          </thead>
          <tbody>
            <For each={summary().agents}>
              {(agent) => (
                <tr>
                  <th scope="row">{agent.name}</th>
                  <td class="billing-meter">Started-hour work</td>
                  <td>{agent.hours}h</td>
                  <td>{amount(agent.rateMinor)}/hr</td>
                  <td>{amount(agent.estimateMinor)}</td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Estimated total</th>
              <td class="billing-meter">{summary().agents.length} agents</td>
              <td>{summary().hours}h</td>
              <td></td>
              <td>{amount(summary().estimateMinor)}</td>
            </tr>
          </tfoot>
        </table>
        <p class="billing-note">
          Started hours and charges are estimates pending billing
          reconciliation.
        </p>
      </section>
    </>
  );
}

export function Usage(props: { result: BillingReading<StartedHourUsage> }) {
  return (
    <ReadState result={props.result} messages={usageMessages}>
      {(usage) => {
        const summary = createMemo(() => summarizeUsage(usage()));
        return (
          <Show
            when={summary()}
            fallback={
              <p class="billing-note" role="status">
                {usageMessages.unavailable}
              </p>
            }
          >
            {(data) => <UsageSummary usage={usage()} summary={data()} />}
          </Show>
        );
      }}
    </ReadState>
  );
}

export function Invoices(props: { result: BillingReading<RecurringInvoice> }) {
  return (
    <section
      class="billing-panel billing-invoices"
      aria-labelledby="billing-invoices-title"
    >
      <header>
        <h2 id="billing-invoices-title">Invoices</h2>
        <span>Recurring subscription</span>
      </header>
      <ReadState
        result={props.result}
        messages={{
          pending: 'Invoice preview is pending.',
          denied: 'You don’t have access to recurring invoices.',
          empty: 'No invoice preview observed.',
          unavailable: 'Invoice preview is unavailable.',
        }}
      >
        {(invoice) => (
          <Show
            when={invoice().nextInvoice}
            fallback={<p class="billing-note">No upcoming invoice preview.</p>}
          >
            {(preview) => (
              <>
                <div class="billing-next">
                  <div>
                    <strong>Next invoice</strong>
                    <span>Preview</span>
                  </div>
                  <strong>
                    {money(preview().amount, invoice().currency, true)}
                  </strong>
                </div>
                <dl class="billing-invoice-lines">
                  <div>
                    <dt>Status</dt>
                    <dd>Upcoming preview</dd>
                  </div>
                  <div>
                    <dt>Invoice date</dt>
                    <dd>
                      <Show when={preview().date} fallback="Not provided">
                        {(date) => formatDate(date())}
                      </Show>
                    </dd>
                  </div>
                  <div>
                    <dt>Applies to</dt>
                    <dd>Recurring team plan</dd>
                  </div>
                </dl>
              </>
            )}
          </Show>
        )}
      </ReadState>
      <div class="billing-note">
        <p>
          <strong>Posted invoices</strong> · None shown here
        </p>
        <p>
          The team payer manages recurring billing in Macro Settings → Billing.
        </p>
      </div>
    </section>
  );
}

export function ModeledUsage(props: { result: BillingReading<ModeledSpend> }) {
  return (
    <section
      class="billing-panel billing-modeled"
      aria-labelledby="billing-modeled-title"
    >
      <header>
        <h2 id="billing-modeled-title">Modeled AI spend</h2>
      </header>
      <p class="billing-note">
        API list-price estimates for model usage. Team charges and recurring
        invoices are reported separately.
      </p>
      <ReadState
        result={props.result}
        messages={{
          pending: 'Modeled spend is pending.',
          denied: 'You don’t have access to modeled spend.',
          empty: 'No model usage observations in this window.',
          unavailable: 'Modeled spend is unavailable.',
        }}
      >
        {(spend) => (
          <div class="billing-note">
            <p>{dateRange(spend().start, spend().end)}</p>
            <dl class="billing-invoice-lines">
              <For each={spend().agents}>
                {(agent) => (
                  <div>
                    <dt>{agent.name}</dt>
                    <dd>{money(agent.amountMinor, spend().currency, true)}</dd>
                  </div>
                )}
              </For>
              <div>
                <dt>Team total</dt>
                <dd>
                  {money(
                    spend().agents.reduce(
                      (sum, agent) => sum + agent.amountMinor,
                      0
                    ),
                    spend().currency,
                    true
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </ReadState>
    </section>
  );
}

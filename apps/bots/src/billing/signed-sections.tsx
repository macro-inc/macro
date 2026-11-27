import type { ListTeamComputerUsageResponse } from '@macro-inc/sdk/generated/auth';
import { createResource, For, Show } from 'solid-js';
import type { BillingReading } from './read';
import { ReadState } from './read-state';
import { Invoices, ModeledUsage } from './sections';
import './signed.css';

const cpuFormat = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const memoryFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

function cpuUsage(percent: number | null | undefined) {
  return percent == null ? 'Unmeasured' : cpuFormat.format(percent / 100);
}

type ComputeReading = BillingReading<ListTeamComputerUsageResponse>;

export function SignedBilling(props: {
  teamId: string;
  readCompute: (teamId: string) => Promise<ComputeReading>;
}) {
  const [resource] = createResource(
    () => props.teamId,
    (teamId) => props.readCompute(teamId)
  );
  const compute = (): ComputeReading => {
    if (resource.loading) return { status: 'pending' };
    if (resource.error) return { status: 'unavailable' };

    const result = resource();
    if (!result) return { status: 'unavailable' };
    if (
      result.status === 'ready' &&
      result.value.every((computer) =>
        computer.points.every((point) => point === null)
      )
    ) {
      return { status: 'empty' };
    }
    return result;
  };

  return (
    <div class="billing-content billing-local">
      <section
        class="billing-panel billing-compute"
        aria-labelledby="billing-compute-title"
      >
        <header>
          <h2 id="billing-compute-title">Compute observations</h2>
          <span>Last 24 hours</span>
        </header>
        <p class="billing-note">
          CPU and memory from the most recent observed 15-minute interval.
        </p>
        <ReadState
          result={compute()}
          messages={{
            pending: 'Loading compute observations…',
            denied: 'You don’t have access to team compute observations.',
            empty: 'No compute observations in the last 24 hours.',
            unavailable: 'Team compute observations are unavailable.',
          }}
        >
          {(computers) => (
            <ul class="billing-computers" aria-label="Team computers">
              <For each={computers()}>
                {(computer) => {
                  const recent = () =>
                    computer.points.findLast((point) => point !== null);

                  return (
                    <li>
                      <strong class="billing-computer-id">
                        {computer.computerId}
                      </strong>
                      <Show
                        when={recent()}
                        fallback={<p>No observations for this computer.</p>}
                      >
                        {(point) => (
                          <dl class="billing-computer-reading">
                            <div>
                              <dt>CPU</dt>
                              <dd>{cpuUsage(point().cpuPercent)}</dd>
                            </div>
                            <div>
                              <dt>Memory</dt>
                              <dd>
                                {memoryFormat.format(
                                  point().memoryBytes / 1024 ** 2
                                )}{' '}
                                MiB
                              </dd>
                            </div>
                          </dl>
                        )}
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          )}
        </ReadState>
      </section>
      <section
        class="billing-panel"
        aria-labelledby="billing-signed-ledger-title"
      >
        <header>
          <h2 id="billing-signed-ledger-title">Usage ledger</h2>
        </header>
        <p class="billing-note">
          Started-hour usage and billed amounts are unavailable.
        </p>
      </section>
      <Invoices result={{ status: 'unavailable' }} />
      <ModeledUsage result={{ status: 'unavailable' }} />
    </div>
  );
}

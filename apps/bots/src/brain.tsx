import { A, useParams } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';
import { brainViews, ownView, scopedBrainPath } from './routes';

export function Unavailable() {
  return (
    <section class="panel sign-in">
      <h1>Unavailable</h1>
      <A href="/fleet">Back to Fleet</A>
    </section>
  );
}

export default function Brain() {
  const params = useParams<{ team: string; bot: string; view: string }>();
  const [bots] = createResource(() =>
    __BOTS_FIXTURES__
      ? import('./fleet-fixture').then((module) => module.fleetBots)
      : []
  );
  const [hire] = createResource(() =>
    __BOTS_FIXTURES__ ? import('./hire-fixture') : undefined
  );
  const bot = () => {
    if (!ownView(brainViews, params.view)) return;

    const receipt = hire()?.hireReceiptFor(params.team, params.bot);
    if (receipt?.agent.status === 'provisioning') {
      return {
        team: receipt.agent.teamId,
        id: receipt.agent.userId,
        name: receipt.agent.name,
        portrait: receipt.portrait,
        width: receipt.width,
        role: 'Setting up',
      };
    }

    if (params.team !== 'sample-team') return;
    const sample = bots()?.find(({ id }) => id === params.bot);
    if (sample) return { ...sample, team: 'sample-team', width: 0 };
  };

  return (
    <Show when={!bots.loading && !hire.loading}>
      <Show when={bot()} fallback={<Unavailable />} keyed>
        {(sample) => (
          <section class="brain">
            <div class="panel">
              <div class="brain-heading">
                <img
                  src={sample.portrait}
                  alt=""
                  style={{ transform: `scaleX(${1 + sample.width / 100})` }}
                />
                <div>
                  <h1>{sample.name}’s Hub</h1>
                  <p>{sample.role} · Sample team</p>
                </div>
              </div>
              <nav aria-label="Brain">
                <For each={Object.keys(brainViews)}>
                  {(view) =>
                    ownView(brainViews, view) && (
                      <A
                        href={scopedBrainPath(sample.team, sample.id, view)}
                        end
                      >
                        {brainViews[view]}
                      </A>
                    )
                  }
                </For>
              </nav>
            </div>
            <div class="notice">
              <h2>
                {ownView(brainViews, params.view) && brainViews[params.view]}
              </h2>
              <p>This section is unavailable in the foundation preview.</p>
            </div>
          </section>
        )}
      </Show>
    </Show>
  );
}

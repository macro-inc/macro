import { A, useParams } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';
import { brainPath, brainViews, ownView } from './routes';

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
  const bot = () => {
    if (params.team !== 'sample-team' || !ownView(brainViews, params.view))
      return;
    return bots()?.find((sample) => sample.id === params.bot);
  };

  return (
    <Show when={!bots.loading}>
      <Show when={bot()} fallback={<Unavailable />} keyed>
        {(sample) => (
          <section class="brain">
            <div class="panel">
              <div class="brain-heading">
                <img src={sample.portrait} alt="" />
                <div>
                  <h1>{sample.name}’s Hub</h1>
                  <p>{sample.role} · Sample team</p>
                </div>
              </div>
              <nav aria-label="Brain">
                <For each={Object.keys(brainViews)}>
                  {(view) =>
                    ownView(brainViews, view) && (
                      <A href={brainPath(sample.id, view)} end>
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

import { A, useLocation } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';
import { brainPath, scopedBrainPath } from './routes';

export default function Fleet() {
  const location = useLocation();
  const [bots] = createResource(() =>
    __BOTS_FIXTURES__
      ? import('./fleet-fixture').then((module) => module.fleetBots)
      : []
  );

  const [hire] = createResource(() =>
    __BOTS_FIXTURES__ ? import('./hire-fixture') : undefined
  );
  const newBot = () => hire()?.hireReceipt();
  const selected = () => hire()?.selectedHireReceipt(location.search);

  return (
    <section class="fleet panel">
      <div class="fleet-heading">
        <h1>
          Fleet{' '}
          <Show when={bots()}>
            {(sample) => <small>{sample().length + (newBot() ? 1 : 0)}</small>}
          </Show>
        </h1>
        <A href="/" class="primary">
          + Add bot
        </A>
      </div>
      <Show
        when={__BOTS_FIXTURES__}
        fallback={
          <p class="notice">
            Fleet is unavailable until Macro sign-in is connected.
          </p>
        }
      >
        <div class="fleet-cards">
          <Show when={newBot()}>
            {(bot) => (
              <article class="panel bot" aria-label="New preview teammate">
                <A
                  class="bot-link"
                  aria-current={selected() === bot() ? 'true' : undefined}
                  href={scopedBrainPath(bot().agent.teamId, bot().agent.userId)}
                  aria-label={`Open ${bot().agent.name}’s Hub`}
                >
                  <div class="bot-portrait">
                    <img
                      src={bot().portrait}
                      alt=""
                      style={{ transform: `scaleX(${1 + bot().width / 100})` }}
                    />
                  </div>
                  <div class="bot-description">
                    <h2>{bot().agent.name}</h2>
                    <p>Setting up · Preview</p>
                  </div>
                </A>
              </article>
            )}
          </Show>
          <For each={bots()}>
            {(bot) => (
              <article class="panel bot">
                <A
                  href={brainPath(bot.id)}
                  class="bot-link"
                  aria-label={`Open ${bot.name}’s Hub`}
                >
                  <div class="bot-portrait">
                    <img src={bot.portrait} alt="" />
                  </div>
                  <div class="bot-description">
                    <h2>{bot.name}</h2>
                    <p>{bot.role}</p>
                  </div>
                </A>
              </article>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

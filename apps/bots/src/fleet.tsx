import { A } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';
import { brainPath } from './routes';

export default function Fleet() {
  const [bots] = createResource(() =>
    __BOTS_FIXTURES__
      ? import('./fleet-fixture').then((module) => module.fleetBots)
      : []
  );

  return (
    <section class="fleet panel">
      <div class="fleet-heading">
        <h1>
          Fleet{' '}
          <Show when={bots()}>
            {(sample) => <small>{sample().length}</small>}
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
            {__BOTS_LOCAL_AUTH__
              ? 'The team-agent roster is unavailable in local auth review.'
              : 'Fleet is unavailable until Macro sign-in is connected.'}
          </p>
        }
      >
        <div class="fleet-cards">
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

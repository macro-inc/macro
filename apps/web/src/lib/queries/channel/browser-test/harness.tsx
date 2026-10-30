import { createChannelDetail } from '@app/features/channels-view/primitives/create-channel-detail';
import { createChannelDetailSource } from '@app/features/channels-view/queries/channel-detail-source';
import { createEffect, createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { refreshActiveGraphqlSoupQueries } from '../../soup/graphql/active-queries';
import { createChannelDetailQuery } from '../detail';
import {
  channelPage,
  createDetailCacheFixture,
} from '../tests/detail-cache-fixture';
import { setClient } from './adapters';

const transport = createDetailCacheFixture();
setClient(transport.client);
function Harness() {
  const source = createChannelDetailSource({
    channelId: () => 'one',
    cached: () => undefined,
    createQuery: createChannelDetailQuery,
  });
  const detail = createChannelDetail({
    selection: () => ({ id: 'one' }),
    cached: () => undefined,
    source,
    markRead: () => {},
  });
  const [history, setHistory] = createSignal<string[]>([]);
  const [error, setError] = createSignal('');
  const [completed, setCompleted] = createSignal(0);
  createEffect(() => {
    const status = detail.view().status;
    setHistory((previous) => [...previous, status]);
  });
  const reply = async (allowed: boolean) => {
    const request = await transport.requests.next();
    request.respond(channelPage(allowed ? 'one' : undefined));
    await transport.results.next();
  };
  const revalidate = async (allowed: boolean) => {
    transport.results.clear();
    const pending = refreshActiveGraphqlSoupQueries();
    await reply(allowed);
    await pending;
  };
  const run = (action: () => Promise<unknown>) => async () => {
    try {
      await action();
      setCompleted((count) => count + 1);
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <main>
      <h1>Channel access regression fixture</h1>
      <p>
        Synthetic transport over the real normalized cache, query, and channel
        detail state.
      </p>
      <nav>
        <button onClick={run(() => reply(true))}>Server allows opening</button>
        <button onClick={run(() => transport.cache(channelPage()))}>
          Cache empty
        </button>
        <button onClick={run(() => reply(true))}>Confirm access</button>
        <button onClick={run(() => revalidate(false))}>
          Server removes access
        </button>
        <button onClick={run(() => transport.cache(channelPage('one')))}>
          Cache has channel
        </button>
        <button onClick={run(() => reply(true))}>Membership restored</button>
      </nav>
      <section aria-label="Channel detail">
        <Show
          when={detail.view().status === 'ready'}
          fallback={
            <h2>
              {detail.view().status === 'loading'
                ? 'Loading conversation'
                : 'Conversation unavailable'}
            </h2>
          }
        >
          <h2>Conversation</h2>
          <p>Channel content remains mounted during stale cache updates.</p>
          <textarea aria-label="Message draft" placeholder="Write a message" />
        </Show>
      </section>
      <output aria-label="State history">{history().join(' → ')}</output>
      <output aria-label="Fixture error">{error()}</output>
      <output aria-label="Completed actions">{completed()}</output>
    </main>
  );
}
const root = document.getElementById('app');
if (!root) throw new Error('Missing fixture root');
render(() => <Harness />, root);

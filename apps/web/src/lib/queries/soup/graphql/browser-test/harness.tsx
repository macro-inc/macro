import { stringifyDocument } from '@urql/core';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { SoupMailBackfillDocument } from '../../../../service-clients/service-storage/graphql/generated/graphql';
import { createSoupLiveQuery } from '../create-soup-live-query';
import { CACHED_IDS, input, type MailTab, response, VIEWER } from './fixtures';
import {
  cacheErrors,
  cacheRevision,
  holdLocalReads,
  host,
  pendingWrites,
  releaseLocalReads,
  setCacheRevision,
} from './runtime';

const container = document.querySelector<HTMLDivElement>('#app')!;
const timeline: Array<{ ids: string[]; source: string | null }> = [];
let recording = false;
function recordRows() {
  if (!recording) return;
  const ids = [
    ...container.querySelectorAll<HTMLElement>('[data-thread-id]'),
  ].map((row) => row.dataset.threadId!);
  const previous = timeline.at(-1);
  if (previous && JSON.stringify(previous.ids) === JSON.stringify(ids)) return;
  timeline.push({
    ids,
    source:
      container.querySelector('#mail-list')?.getAttribute('data-source') ??
      null,
  });
}
const observer = new MutationObserver(recordRows);
observer.observe(container, {
  childList: true,
  subtree: true,
  attributes: true,
});

const api = {
  releaseLocalReads,
  startRecording() {
    timeline.length = 0;
    recording = true;
    recordRows();
  },
  stopRecording() {
    recordRows();
    recording = false;
    return {
      timeline: structuredClone(timeline),
      cacheErrors: [...cacheErrors],
    };
  },
};
declare global {
  interface Window {
    mailFlicker: typeof api;
  }
}
window.mailFlicker = api;

function MailList(props: { tab: MailTab }) {
  const source = createSoupLiveQuery(() => input(props.tab));
  const phase = () => {
    if (
      source.localRevision() === undefined ||
      source.localRevision() !== cacheRevision()
    )
      return 'pending';
    if (source.cachedMail()) return 'local';
    if (!source.isFetching() && pendingWrites() === 0) return 'network';
    return 'pending';
  };
  return (
    <section id="mail-list" data-tab={props.tab} data-source={phase()}>
      <p role="status">{source.error()?.message ?? phase()}</p>
      <ol>
        <For each={source.data()}>
          {(thread) => <li data-thread-id={thread.id}>{thread.displayName}</li>}
        </For>
      </ol>
    </section>
  );
}

function App() {
  const [tab, setTab] = createSignal<MailTab>('noise');
  const navigate = (next: MailTab) => {
    if (next === 'noise') holdLocalReads();
    else releaseLocalReads();
    setTab(next);
  };
  return (
    <>
      <h1>Mail cache/network flicker regression</h1>
      <p>
        Real Soup query source, normalized exchange, and worker/WASM/OPFS cache.
      </p>
      <button onClick={() => navigate('drafts')}>Drafts</button>
      <button onClick={() => navigate('signal')}>Inbox</button>
      <button onClick={() => navigate('noise')}>Noise</button>
      <Show when={tab()} keyed>
        {(current) => <MailList tab={current} />}
      </Show>
    </>
  );
}

if (new URLSearchParams(location.search).get('seed') !== 'false') {
  await host.writeQuery({
    query: stringifyDocument(SoupMailBackfillDocument),
    operationName: 'SoupMailBackfill',
    variables: { input: { initial: { ...input('noise'), expand: true } } },
    data: response(CACHED_IDS),
    identity: VIEWER,
  });
}
setCacheRevision(await host.currentRevision());
const dispose = render(() => <App />, container);
window.addEventListener(
  'pagehide',
  () => {
    observer.disconnect();
    dispose();
    host.dispose();
  },
  { once: true }
);

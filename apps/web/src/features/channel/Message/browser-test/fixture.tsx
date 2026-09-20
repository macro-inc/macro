import { createSignal, For, onCleanup, onMount, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { ThreadList } from '../../Channel/ThreadList';
import { LinkPreviews } from '../LinkPreviews';
import { Root } from '../Root';
import '../../../../index.css';
import './style.css';

for (const [token, color] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, color);
}

const [phase, setPhase] = createSignal('Waiting for metadata');
const [maxHeightChange, setMaxHeightChange] = createSignal(0);
const [suspensions, setSuspensions] = createSignal(0);
const virtual = new URLSearchParams(location.search).has('virtual');
const rows = Array.from({ length: virtual ? 35 : 3 }, (_, index) => `${index}`);
function MessageRow(props: { id: string }) {
  const url = `https://example.com/article-${props.id}`;
  return (
    <Root
      data-testid={`message-${props.id}`}
      class="fixture-message"
      message={{
        id: props.id,
        sender_id: 'fixture-user',
        content: url,
        created_at: '',
        updated_at: '',
        attachments: [],
        reactions: [],
      }}
    >
      <div class="fixture-author">Taylor · Message {props.id}</div>
      <p>
        Here is the article: <a href={url}>{url}</a>
      </p>
      <LinkPreviews channelId="fixture" />
      <p data-testid={`anchor-${props.id}`}>
        This line must stay in place while the preview loads.
      </p>
    </Root>
  );
}
function App() {
  let root!: HTMLDivElement;
  onMount(() => {
    const heights = new WeakMap<Element, number>();
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.target.getBoundingClientRect().height;
        const initial = heights.get(entry.target);
        if (initial === undefined) heights.set(entry.target, height);
        else
          setMaxHeightChange((previous) =>
            Math.max(previous, Math.abs(height - initial))
          );
      }
    });
    const update = () => {
      for (const row of root.querySelectorAll('[data-message]'))
        resize.observe(row);
      const cards = [...root.querySelectorAll('[data-link-preview]')];
      if (cards.some((card) => card.getAttribute('aria-busy') === 'false'))
        setPhase('Metadata settled');
      if (
        [...root.querySelectorAll('img')].some(
          (img) => img.complete && img.naturalWidth
        )
      )
        setPhase('Images loaded');
    };
    const observer = new MutationObserver(update);
    const suspenseObserver = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (
            node instanceof Element &&
            (node.matches('[data-testid="channel-suspended"]') ||
              node.querySelector('[data-testid="channel-suspended"]'))
          )
            setSuspensions((count) => count + 1);
        }
    });
    update();
    root.addEventListener('load', update, true);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    suspenseObserver.observe(document.body, { subtree: true, childList: true });
    onCleanup(() => {
      observer.disconnect();
      suspenseObserver.disconnect();
      resize.disconnect();
      root.removeEventListener('load', update, true);
    });
  });
  return (
    <main>
      <h1>Channel preview loading</h1>
      <p class="fixture-status" role="status">
        {phase()}
      </p>
      <p>
        Largest measured message resize:{' '}
        <strong data-testid="max-height-change">{maxHeightChange()}px</strong> ·
        Channel suspensions:{' '}
        <strong data-testid="suspension-count">{suspensions()}</strong>
      </p>
      <Suspense
        fallback={<div data-testid="channel-suspended">Channel suspended</div>}
      >
        <section ref={root} data-testid="channel" class="fixture-channel">
          {virtual ? (
            <ThreadList keys={() => rows}>
              {({ id }) => <MessageRow id={id} />}
            </ThreadList>
          ) : (
            <For each={rows}>{(id) => <MessageRow id={id} />}</For>
          )}
        </section>
      </Suspense>
      <label>
        Composer{' '}
        <input data-testid="composer" placeholder="Draft stays mounted" />
      </label>
    </main>
  );
}
render(() => <App />, document.getElementById('root')!);

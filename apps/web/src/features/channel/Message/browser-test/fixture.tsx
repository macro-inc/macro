import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { ThreadList } from '../../Channel/ThreadList';
import { LinkPreviews } from '../LinkPreviews';
import {
  setShowLinkPreviews,
  showLinkPreviews,
} from '../link-preview-visibility';
import { Root } from '../Root';
import '../../../../index.css';
import './style.css';

for (const [token, color] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, color);
}

const [phase, setPhase] = createSignal('Waiting for metadata');
const [maxHeightChange, setMaxHeightChange] = createSignal(0);
const [suspensions, setSuspensions] = createSignal(0);
const parameters = new URLSearchParams(location.search);
const virtual = parameters.has('virtual');
const [mounted, setMounted] = createSignal(true);
const rows = Array.from(
  { length: virtual ? 35 : parameters.has('content') ? 1 : 3 },
  (_, index) => `${index}`
);
function MessageRow(props: { id: string }) {
  const url = `https://example.com/article-${props.id}`;
  return (
    <Root
      data-testid={`message-${props.id}`}
      class="fixture-message"
      message={{
        id: props.id,
        sender_id: parameters.has('other-sender')
          ? 'someone-else'
          : 'fixture-user',
        content: parameters.get('content') ?? url,
        deleted_at: parameters.has('deleted')
          ? '2026-01-01T00:00:00Z'
          : undefined,
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
      <Show when={mounted()}>
        <LinkPreviews channelId="fixture" />
      </Show>
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
      <div class="fixture-controls">
        <label>
          <input
            type="checkbox"
            checked={showLinkPreviews()}
            onChange={(event) =>
              setShowLinkPreviews(event.currentTarget.checked)
            }
          />{' '}
          Show link previews
        </label>
        <button type="button" onClick={() => setMounted((value) => !value)}>
          {mounted() ? 'Unmount previews' : 'Remount previews'}
        </button>
      </div>
      <label>
        Composer{' '}
        <input data-testid="composer" placeholder="Draft stays mounted" />
      </label>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);

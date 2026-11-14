import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  formatLocation,
  type PaneId,
  type SplitPanePolicy,
  type SplitSide,
} from '@app/lib/split-router';
import { appRoutes } from '@app/lib/split-router/tests/fixtures';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  captureScrollAnchor,
  keepScrollAnchorOnResize,
} from '@core/util/scrollAnchor';
import { For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { TiledSplits } from '../TiledSplits';

const history = createMemoryHistory('/home');

// The next new pane splits this one; otherwise it opens at the end.
let nextSplit: { pane: PaneId; side: SplitSide } | undefined;

const policy: SplitPanePolicy = {
  placeNewPane: ({ panes }) => {
    const split = nextSplit;
    nextSplit = undefined;

    return split
      ? { split: split.pane, side: split.side }
      : { insertAt: panes.length };
  },
  closeAction: ({ panes }) =>
    panes.length > 1 ? { type: 'remove' } : { type: 'keep' },
  activate: () => {},
};

const router = createSplitRouter({
  routes: appRoutes,
  history,
  paneStore: createMemoryPaneStore<Entry>(),
  policy,
});

Reflect.set(window, 'tiledSplitsUrl', () => formatLocation(history.read()));

const DESTINATIONS = ['/drive', '/mail', '/md/d1', '/md/d2', '/md/d3'];
let opened = 0;
let mounts = 0;

const PARAGRAPHS = Array.from(
  { length: 80 },
  (_, i) =>
    `Paragraph ${i}. ` +
    'Reading text that wraps onto more or fewer lines as the split narrows or widens. '.repeat(
      1 + (i % 4)
    )
);

// A document's scroll container, as a markdown split has one. WebKit has no
// CSS scroll anchoring; `overflow-anchor: none` gives Chromium the same
// behavior, so a test sees what a reader sees in Safari or the desktop app.
function Reading() {
  let scroller!: HTMLDivElement;
  let text!: HTMLDivElement;
  onMount(() =>
    onCleanup(
      keepScrollAnchorOnResize(scroller, () =>
        captureScrollAnchor(scroller, text)
      )
    )
  );

  return (
    <div ref={scroller} class="reading" data-reading>
      <div ref={text}>
        <For each={PARAGRAPHS}>{(paragraph) => <p>{paragraph}</p>}</For>
      </div>
    </div>
  );
}

function Pane(props: { pane: PaneId }) {
  // Counts mounts, so a test can tell a moved pane from a remounted one.
  const mount = ++mounts;
  const label = () =>
    router
      .entry(props.pane)
      ?.location.route.matches.map((match) => match.id)
      .filter((id) => id !== 'app')
      .join('/');

  const split = (side: SplitSide) => {
    nextSplit = { pane: props.pane, side };
    const destination = DESTINATIONS[opened++ % DESTINATIONS.length]!;
    const opening = router.open(destination, {
      newPane: true,
      source: props.pane,
    });
    fireAndForget(opening, 'tiled-splits-fixture');
  };

  return (
    <section
      class="pane"
      data-pane={label()}
      data-mount={mount}
      aria-label={label()}
    >
      <strong>{label()}</strong>
      <textarea aria-label={`${label()} draft`} />
      <button type="button" onClick={() => split('below')}>
        Split below
      </button>
      <button type="button" onClick={() => split('right')}>
        Split right
      </button>
      <button
        type="button"
        onClick={() =>
          fireAndForget(router.close(props.pane), 'tiled-splits-fixture')
        }
      >
        Close
      </button>
      <Show when={label() === 'block'}>
        <Reading />
      </Show>
    </section>
  );
}

function App() {
  return (
    <>
      <style>{`
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px sans-serif; }
      .area { position: absolute; left: 0; top: 0; width: 1200px; height: 800px; }
      .pane { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 4px; padding: 8px; border: 1px solid #888; overflow: hidden; }
      .reading { flex: 1; min-height: 0; overflow: auto; overflow-anchor: none; }
      `}</style>
      <div class="area">
        <TiledSplits
          layout={router.layout}
          panes={router.panes}
          gutter={6}
          showDividers={false}
          onResize={router.resizeLayout}
          onArea={() => {}}
        >
          {(pane) => <Pane pane={pane} />}
        </TiledSplits>
      </div>
    </>
  );
}

render(() => <App />, document.getElementById('root')!);

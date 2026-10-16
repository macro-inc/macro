import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { createDemoPointer } from '../agents/createDemoPointer';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { PanelSection } from '../workspace/frozen/DetailPanel';
import { DocumentFrame } from './DocumentFrame';
import {
  type DocumentSource,
  DocumentSourceLink,
  DocumentSourceView,
} from './DocumentProjectDemo';
import { PROJECT_INTRO, PROJECT_TAGS, PROJECT_TITLE } from './documentProject';

/** Each source gets its own split; existing panes and edits remain mounted. */
export function DocumentMentionsDemo() {
  let root!: HTMLDivElement;
  let splits!: HTMLDivElement;
  const [sources, setSources] = createSignal<DocumentSource[]>([]);
  const [active, setActive] = createSignal<DocumentSource>();
  const [width, setWidth] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [phase, setPhase] = createSignal(0);
  const triggers = new Map<DocumentSource, HTMLElement>();
  const narrow = () => width() < 480 || width() / (sources().length + 1) < 240;
  const add = (source: DocumentSource) => {
    setSources((items) =>
      items.includes(source) ? items : [...items, source]
    );
    setActive(source);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
      setSources(['email', 'task']);
      setActive('task');
    },
    delay: (step) => [0, 1400, 1000, 2400, 1000, 900][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 2) add('email');
      if (step === 4 && width() >= 1020) add('task');
      if (step === 5) setAutomatic(false);
    },
  });
  const pause = () => {
    playback.pause();
    setAutomatic(false);
  };
  const open = (source: DocumentSource) => {
    pause();
    if (document.activeElement instanceof HTMLElement)
      triggers.set(source, document.activeElement);
    add(source);
    queueMicrotask(() =>
      root
        .querySelector<HTMLButtonElement>(
          `[aria-label="Close ${source} split"]`
        )
        ?.focus({ preventScroll: true })
    );
  };
  const close = (source: DocumentSource) => {
    pause();
    const remaining = sources().filter((item) => item !== source);
    setSources(remaining);
    setActive(remaining.at(-1));
    queueMicrotask(() => {
      const next =
        narrow() && remaining.length
          ? root.querySelector<HTMLButtonElement>(
              `[aria-label="Close ${remaining.at(-1)} split"]`
            )
          : triggers.get(source);
      next?.focus({ preventScroll: true });
    });
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: () =>
      automatic() && !(narrow() && sources().length)
        ? phase() === 1
          ? '[data-doc-mention="email"]'
          : phase() === 3 && width() >= 1020
            ? '[data-doc-mention="task"]'
            : undefined
        : undefined,
  });
  onMount(() => {
    const measure = () => setWidth(splits.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(splits);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="doc-story" ref={root}>
      <ProductDemo
        label="Open email and tasks beside the Website brief"
        height={630}
        mobileHeight={620}
        onInteract={pause}
      >
        <div
          ref={splits}
          class="doc-multi-split"
          data-narrow={narrow()}
          data-open={sources().length > 0}
          data-pane-count={sources().length + 1}
        >
          <div
            class="doc-multi-original dummy-main"
            inert={narrow() && !!active()}
            aria-hidden={narrow() && !!active()}
          >
            <DocumentFrame
              title={PROJECT_TITLE}
              tags={PROJECT_TAGS}
              panel={
                <PanelSection title="References (1)" open>
                  <p class="doc-ref-head">
                    Jacob in{' '}
                    <DocumentSourceLink source="channel" onOpen={open} />
                  </p>
                  <p class="doc-ref-body">
                    put everything in here · Website brief
                  </p>
                </PanelSection>
              }
            >
              <h2>Pricing</h2>
              <p>
                Use the details from{' '}
                <DocumentSourceLink source="email" onOpen={open} />.
              </p>
              <p>{PROJECT_INTRO}</p>
              <h2>Implementation</h2>
              <p>
                Teo owns <DocumentSourceLink source="task" onOpen={open} />.
                Check mobile before publishing.
              </p>
              <h2>Discussion</h2>
              <p>
                Shared in <DocumentSourceLink source="channel" onOpen={open} />.
                Teo will post the preview there.
              </p>
            </DocumentFrame>
          </div>
          <For each={sources()}>
            {(source) => (
              <div
                class="doc-multi-pane dummy-main"
                data-active={active() === source}
                inert={narrow() && active() !== source}
                aria-hidden={narrow() && active() !== source}
              >
                <DocumentSourceView
                  source={source}
                  onClose={() => close(source)}
                  autoFocus={false}
                  label={`Linked ${source}`}
                  closeLabel={`Close ${source} split`}
                />
              </div>
            )}
          </For>
        </div>
      </ProductDemo>
      <Show when={pointer()}>
        {(p) => (
          <DemoCursor
            label="Jacob"
            class="doc-organize-pointer"
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

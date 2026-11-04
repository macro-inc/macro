import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { useArtifactLibrary } from '../context/artifact-library';
import {
  ARTIFACT_SANDBOX,
  artifactThemeTokens,
  composeArtifactDocument,
  isArtifactLoadMarker,
} from '../core/artifact-document';

/**
 * Runs artifact HTML in an opaque-origin frame, laid out at its design size and
 * scaled to fit. Never add `allow-same-origin`: with `allow-scripts` the document
 * could remove its own sandbox and act as the signed-in user.
 */
export function ArtifactFrame(props: {
  html: string;
  title: string;
  designWidth: number;
  designHeight: number;
  interactive: boolean;
  /** Mount even offscreen, for renders that must capture every artifact. */
  eager?: boolean;
  /** A navigation key pressed while focus is inside the frame. */
  onKey?: (key: string) => void;
}) {
  let host!: HTMLDivElement;
  let frame: HTMLIFrameElement | undefined;
  const artifacts = useArtifactLibrary();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [visible, setVisible] = createSignal(!!props.eager);
  const [generation, setGeneration] = createSignal(0);
  const [navigatedAway, setNavigatedAway] = createSignal(false);
  let restarts: number[] = [];

  const scale = () =>
    Math.min(
      size().width / props.designWidth,
      size().height / props.designHeight
    );
  const loadToken = crypto.randomUUID();
  const srcdoc = createMemo(() =>
    composeArtifactDocument(
      props.html,
      artifactThemeTokens(document.documentElement),
      artifacts.library(),
      loadToken
    )
  );
  const mounted = createMemo(() => ({
    content: srcdoc(),
    generation: generation(),
  }));
  createEffect(
    on(srcdoc, () => {
      restarts = [];
      setNavigatedAway(false);
    })
  );

  /**
   * The policy cannot follow a navigation to another page, so a load that was not
   * announced with this frame's token replaces the frame with the artifact's
   * own document. Moving a frame in the DOM, which a layer reorder does, reloads it
   * and announces again, so it needs no restart. An artifact that keeps leaving is
   * stopped.
   */
  const restart = () => {
    const now = Date.now();
    restarts = [...restarts.filter((at) => now - at < 10_000), now];
    if (restarts.length > 3) setNavigatedAway(true);
    else setGeneration((value) => value + 1);
  };

  onMount(() => {
    const forwardKey = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;

      const key: unknown = event.data?.macroArtifactKey;
      if (typeof key === 'string') props.onKey?.(key);
    };
    window.addEventListener('message', forwardKey);
    onCleanup(() => window.removeEventListener('message', forwardKey));

    const sizes = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    sizes.observe(host);
    onCleanup(() => sizes.disconnect());

    if (props.eager) return;
    // A canvas can hold many artifacts; only those on screen run their scripts.
    const viewport = new IntersectionObserver(([entry]) => {
      setVisible(!!entry?.isIntersecting);
    });
    viewport.observe(host);
    onCleanup(() => viewport.disconnect());
  });

  return (
    <div ref={host} class="relative size-full overflow-hidden">
      <Show
        when={!navigatedAway()}
        fallback={
          <div class="grid size-full place-items-center p-4 text-center text-xs text-ink-muted">
            This artifact tried to leave its page and was stopped.
          </div>
        }
      >
        <Show when={visible() ? mounted() : undefined} keyed>
          {(frame) => {
            let element: HTMLIFrameElement | undefined;
            let loads = 0;
            let announced = 0;
            let checkLoad: ReturnType<typeof setTimeout> | undefined;
            const onMessage = (event: MessageEvent) => {
              if (
                element &&
                event.source === element.contentWindow &&
                isArtifactLoadMarker(event.data, loadToken)
              )
                announced += 1;
            };
            window.addEventListener('message', onMessage);
            onCleanup(() => {
              window.removeEventListener('message', onMessage);
              clearTimeout(checkLoad);
            });

            return (
              <iframe
                title={props.title}
                data-canvas-artifact-frame
                sandbox={ARTIFACT_SANDBOX}
                allow=""
                referrerPolicy="no-referrer"
                srcdoc={frame.content}
                tabIndex={props.interactive ? 0 : -1}
                ref={(iframe) => {
                  element = iframe;
                  frame = iframe;
                }}
                onLoad={() => {
                  // The message and the load event can arrive in either order.
                  loads += 1;
                  clearTimeout(checkLoad);
                  checkLoad = setTimeout(() => {
                    if (loads > announced) restart();
                  }, 250);
                }}
                class="absolute left-1/2 top-1/2 border-0"
                style={{
                  width: `${props.designWidth}px`,
                  height: `${props.designHeight}px`,
                  transform: `translate(-50%, -50%) scale(${scale()})`,
                  'pointer-events': props.interactive ? 'auto' : 'none',
                }}
              />
            );
          }}
        </Show>
      </Show>
    </div>
  );
}

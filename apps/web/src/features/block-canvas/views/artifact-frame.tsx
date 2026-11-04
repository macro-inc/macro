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
}) {
  let host!: HTMLDivElement;
  const artifacts = useArtifactLibrary();
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  const [visible, setVisible] = createSignal(!!props.eager);
  const [navigatedAway, setNavigatedAway] = createSignal(false);

  const scale = () =>
    Math.min(
      size().width / props.designWidth,
      size().height / props.designHeight
    );
  const srcdoc = createMemo(() =>
    composeArtifactDocument(
      props.html,
      artifactThemeTokens(document.documentElement),
      artifacts.library()
    )
  );
  createEffect(on(srcdoc, () => setNavigatedAway(false)));

  onMount(() => {
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
        <Show when={visible() ? srcdoc() : undefined} keyed>
          {(content) => {
            let loads = 0;
            return (
              <iframe
                title={props.title}
                data-canvas-artifact-frame
                sandbox={ARTIFACT_SANDBOX}
                allow=""
                referrerPolicy="no-referrer"
                srcdoc={content}
                tabIndex={props.interactive ? 0 : -1}
                // The policy cannot follow a navigation to another page, so a
                // second load removes the frame.
                onLoad={() => {
                  loads += 1;
                  if (loads > 1) setNavigatedAway(true);
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

import { Dialog } from '@kobalte/core/dialog';
import X from '@phosphor/x.svg';
import Play from '@phosphor-fill/play-fill.svg';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import './homepage-interactive-demo.css';

/** Opens the real standalone sample route, keeping its styles and state isolated. */
export function HomepageInteractiveDemo() {
  const [open, setOpen] = createSignal(false);
  const [loaded, setLoaded] = createSignal(false);
  let host!: HTMLDivElement;
  let path!: SVGPathElement;
  let trigger!: HTMLButtonElement;
  let frameDocument: Document | undefined;
  const onFrameKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Capture the layer before its own Escape handler removes it from the DOM.
    const innerLayer = frameDocument?.querySelector(
      '[role="dialog"]:not([data-closed]), [role="alertdialog"]:not([data-closed]), [role="menu"]:not([data-closed]), [role="listbox"]:not([data-closed])'
    );
    if (innerLayer) return;
    const currentDocument = frameDocument;
    queueMicrotask(() => {
      if (!event.defaultPrevented && frameDocument === currentDocument)
        changeOpen(false);
    });
  };
  const releaseFrame = () => {
    frameDocument?.removeEventListener('keydown', onFrameKey, true);
    frameDocument = undefined;
  };
  const changeOpen = (value: boolean) => {
    if (!value) releaseFrame();
    setLoaded(false);
    setOpen(value);
  };
  onCleanup(releaseFrame);

  onMount(() => {
    const anchor = host
      .closest('section')
      ?.querySelector<HTMLElement>('.homepage-sidebar-bottom-anchor');
    if (!anchor) return;
    let scroller = host.parentElement!;
    while (
      scroller.parentElement &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let start = 0;
    const update = () => {
      const progress = reduced.matches
        ? 1
        : Math.max(0, Math.min(1, (scroller.scrollTop - start) / 150));
      path.style.strokeDashoffset = String(1 - progress);
    };
    const measure = () => {
      const bounds = host.getBoundingClientRect();
      const tip = anchor.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      const scale = host.clientWidth / bounds.width;
      const x = (tip.left - bounds.left) * scale;
      const y = (tip.top - bounds.top) * scale;
      const center = host.clientWidth / 2;
      path.setAttribute(
        'd',
        `M${x} ${y} C${x} ${y + 75} ${center} 75 ${center} 150`
      );
      start =
        bounds.top -
        viewport.top +
        scroller.scrollTop -
        scroller.clientHeight * 0.8;
      update();
    };
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    resize.observe(anchor.parentElement!);
    resize.observe(scroller);
    scroller.addEventListener('scroll', update, { passive: true });
    reduced.addEventListener('change', update);
    measure();
    onCleanup(() => {
      resize.disconnect();
      scroller.removeEventListener('scroll', update);
      reduced.removeEventListener('change', update);
    });
  });

  return (
    <div ref={host} class="homepage-interactive-demo">
      <svg class="homepage-demo-connection" fill="none" aria-hidden="true">
        <path ref={path} pathLength="1" />
      </svg>
      <Dialog open={open()} onOpenChange={changeOpen} modal>
        <Dialog.Trigger ref={trigger} class="homepage-demo-launch">
          <span class="homepage-demo-play">
            <Play aria-hidden="true" />
          </span>
          <span class="homepage-demo-label">Interactive demo</span>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay class="homepage-demo-overlay" />
          <Dialog.Content
            class="homepage-demo-modal"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.focus({ preventScroll: true });
            }}
          >
            <header class="homepage-demo-titlebar">
              <div class="homepage-demo-traffic">
                <Dialog.CloseButton
                  class="homepage-demo-red"
                  aria-label="Close demo window"
                >
                  <X />
                </Dialog.CloseButton>
                <span class="homepage-demo-yellow" aria-hidden="true" />
                <span class="homepage-demo-green" aria-hidden="true" />
              </div>
              <Dialog.Title>Macro · Interactive demo</Dialog.Title>
              <Dialog.CloseButton
                class="homepage-demo-close"
                aria-label="Close interactive demo"
              >
                <X />
              </Dialog.CloseButton>
            </header>
            <Dialog.Description class="homepage-demo-sr-only">
              Explore the sample workspace. Changes stay in this session.
            </Dialog.Description>
            <div class="homepage-demo-frame-wrap">
              <Show when={!loaded()}>
                <div class="homepage-demo-loading" role="status">
                  Opening your workspace…
                </div>
              </Show>
              <Show when={open()}>
                <iframe
                  src="/demo"
                  title="Macro interactive sample workspace"
                  class="homepage-demo-frame"
                  onLoad={(event) => {
                    releaseFrame();
                    frameDocument =
                      event.currentTarget.contentDocument ?? undefined;
                    frameDocument?.addEventListener(
                      'keydown',
                      onFrameKey,
                      true
                    );
                    setLoaded(true);
                  }}
                />
              </Show>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </div>
  );
}

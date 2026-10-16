import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import {
  arrivalGroups,
  createHomeInbox,
  DoneToast,
  HomeDetail,
  HomeSidebar,
  markDoneOnE,
  reviewRequestRow,
} from './ReviewHome';
import '../workspace/dummy-workspace.css';
import './review-stories.css';

type Point = { x: number; y: number };

/**
 * Keeps an overlay on a target inside `frame`, re-measured whenever the
 * target selector changes or the frame resizes (the TaskCreationFlow model).
 */
function trackTarget(options: {
  frame: () => HTMLElement;
  selector: Accessor<string | undefined>;
  measure: (target: DOMRect, frame: DOMRect) => Point;
}) {
  const [point, setPoint] = createSignal<Point>();
  onMount(() => {
    const position = () => {
      const selector = options.selector();
      const target = selector
        ? options.frame().querySelector<HTMLElement>(selector)
        : null;
      const bounds = target?.getBoundingClientRect();
      // A target hidden by the narrow layout has no box to point at.
      if (!bounds || (bounds.width === 0 && bounds.height === 0)) {
        setPoint(undefined);
        return;
      }
      setPoint(
        options.measure(bounds, options.frame().getBoundingClientRect())
      );
    };
    createEffect(() => {
      options.selector();
      const timer = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(timer));
    });
    const resize = new ResizeObserver(position);
    resize.observe(options.frame());
    options.frame().addEventListener('scroll', position, true);
    onCleanup(() => {
      resize.disconnect();
      options.frame().removeEventListener('scroll', position, true);
    });
  });
  return point;
}

const pointAt = (target: DOMRect, frame: DOMRect): Point => ({
  x: target.left - frame.left + Math.min(target.width / 2, 72),
  y: target.top - frame.top + target.height / 2,
});

/**
 * A review request arrives at the top of Home. Jacob opens it, reads the PR,
 * then the demo stays put until the visitor marks it done.
 * Phases: 0 Home, 1 request arrives, 2 point at it, 3 open.
 */
export function ReviewInboxDemo() {
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const inbox = createHomeInbox({
    groups: arrivalGroups,
    initial: 'channel-website',
    pending: ['pr-491'],
  });
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const arrive = () => inbox.reveal(reviewRequestRow.id);
  const openRequest = () => {
    arrive();
    inbox.open(reviewRequestRow);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    // A still frame is most useful with the pull request open.
    reduced: openRequest,
    delay: (step) => [0, 900, 1200, 800, 2600][step] ?? 1400,
    advance: (step) => {
      if (step === 1) arrive();
      if (step === 3) openRequest();
      if (step === 3) setAutomatic(false);
      setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    arrive();
    playback.pause();
  };
  const pointer = trackTarget({
    frame: () => frame,
    selector: () =>
      automatic()
        ? [
            undefined,
            '[data-home-row="channel-website"]',
            '[data-home-row="pr-491"]',
            '[data-home-row="pr-491"]',
          ][phase()]
        : undefined,
    measure: pointAt,
  });
  return (
    <div ref={root} class="review-flow">
      <div ref={frame} class="review-flow-frame" onFocusIn={pause}>
        <ProductDemo
          label="A review request arrives in Home and opens the pull request"
          onInteract={pause}
          height={520}
          mobileHeight={500}
        >
          <div
            class="review-home review-home-zoomed"
            data-pane={inbox.pane()}
            onKeyDown={markDoneOnE(inbox)}
          >
            <HomeSidebar
              inbox={inbox}
              arriving={phase() >= 1 ? reviewRequestRow.id : undefined}
            />
            <div class="dummy-main review-home-main">
              <HomeDetail inbox={inbox} />
            </div>
            <DoneToast inbox={inbox} />
          </div>
        </ProductDemo>
        <Show when={pointer()}>
          {(p) => (
            <DemoCursor
              label="Jacob"
              class="review-flow-pointer"
              clicking={phase() === 3}
              style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
            />
          )}
        </Show>
      </div>
    </div>
  );
}

export { GithubConversationDemo as PrLinkDemo } from './GithubWorkflow';

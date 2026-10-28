import { createSignal, Show } from 'solid-js';
import { createDemoPointer } from '../../primitives/createDemoPointer';
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
    loop: { hold: 8500 },
    reset: () => {
      inbox.reset();
      setPhase(0);
      setAutomatic(true);
    },
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
  const pointer = createDemoPointer({
    frame: () => frame,
    active: automatic,
    target: () =>
      automatic()
        ? [
            undefined,
            '[data-home-row="channel-website"]',
            '[data-home-row="pr-491"]',
            '[data-home-row="pr-491"]',
          ][phase()]
        : undefined,
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

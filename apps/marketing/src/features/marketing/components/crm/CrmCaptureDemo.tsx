import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import type { SampleCompany } from '../../core/workspace-fixtures';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { CrmRecordWorkspace } from './CrmRecordWorkspace';

const request: WorkspaceComment = {
  id: 'capture-request',
  person: 'jacob',
  body: '@[Claude](demo-mention:claude) just got off a call with Dana. They want a demo Thursday at 9 for the studio team. Move The Meadow to Demo, make me the owner, and note that Alex Chen is running the rollout on their side.',
  time: '9:51 AM',
};
const reply: WorkspaceComment = {
  id: 'capture-reply',
  person: 'claude',
  body: 'Done. The Meadow is in Demo and you’re the owner. From the call: demo Thursday at 9 with the studio team, and Alex Chen (alex@meadow.example) is running the rollout on their side.',
  time: '9:52 AM',
  replyTo: 'capture-request',
};

/**
 * @Claude in a company's Discussion: the agent sets Stage and Owner through
 * the property tools and answers in the thread. Phases: 0 request, 1 Stage,
 * 2 Stage set, 3 Owner, 4 Owner set, 5 thread, 6 reply.
 */
export function CrmCaptureDemo() {
  let frame!: HTMLDivElement;
  const w = createDummyWorkspace('crm');
  const meadow = (patch: Partial<SampleCompany>) =>
    w.setData('companies', (company) => company.id === 'meadow', patch);
  meadow({ stage: 'Lead', owner: '', comments: [request] });
  w.open('crm', 'meadow');
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const finish = () => {
    meadow({ stage: 'Demo', owner: 'jacob', comments: [request, reply] });
    setPhase(6);
  };
  const playback = createProductWalkthrough({
    root: () => frame,
    steps: 6,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
      finish();
    },
    delay: (step) => [0, 900, 900, 1000, 900, 1000, 900][step] ?? 1000,
    advance: (step) => {
      if (step === 2) meadow({ stage: 'Demo' });
      if (step === 4) meadow({ owner: 'jacob' });
      if (step === 6) {
        finish();
        setAutomatic(false);
        // Like a chat, the record scrolls to the new reply when it lands
        // below the fold (or under the phone's details sheet).
        requestAnimationFrame(() => {
          const scroll = frame.querySelector('.sample-company-scroll');
          scroll?.scrollTo?.({ top: scroll.scrollHeight, behavior: 'smooth' });
        });
      } else setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const action = () =>
    phase() === 1 || phase() === 2
      ? 'stage'
      : phase() === 3 || phase() === 4
        ? 'owner'
        : undefined;
  onMount(() => {
    const position = () => {
      const selector = [
        undefined,
        '[data-company-property="stage"]',
        '[data-company-property="stage"]',
        '[data-company-property="owner"]',
        '[data-company-property="owner"]',
        '[data-thread-id="capture-request"] .sample-message-row',
      ][phase()];
      const target = selector
        ? frame.querySelector<HTMLElement>(selector)
        : undefined;
      if (!automatic() || !target) {
        setPointer(undefined);
        return;
      }
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      const thread = phase() === 5;
      setPointer({
        x: bounds.left - parent.left + (thread ? 56 : bounds.width * 0.6),
        y:
          bounds.top -
          parent.top +
          (thread ? bounds.height + 18 : bounds.height / 2),
      });
    };
    createEffect(() => {
      phase();
      automatic();
      const timer = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(timer));
    });
    const resize = new ResizeObserver(position);
    resize.observe(frame);
    onCleanup(() => resize.disconnect());
  });
  return (
    <div ref={frame} class="crm-demo-frame" onFocusIn={pause}>
      <ProductDemo
        label="Claude updates The Meadow from a comment in its Discussion"
        onInteract={pause}
        action={action()}
        height={600}
        mobileHeight={700}
      >
        <CrmRecordWorkspace workspace={w} initialPanelOpen />
      </ProductDemo>
      <Show when={automatic() && pointer()}>
        {(p) => (
          <DemoCursor
            label="Claude"
            class="crm-demo-pointer"
            clicking={phase() === 2 || phase() === 4}
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

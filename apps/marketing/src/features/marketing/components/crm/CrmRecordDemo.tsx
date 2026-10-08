import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import type { CompanySection } from '../workspace/WorkspaceCompanies';
import { CrmRecordWorkspace } from './CrmRecordWorkspace';

/** Tab the walkthrough points at, then opens, for each step. */
const tour: (CompanySection | undefined)[] = [
  undefined,
  'emails',
  'emails',
  'calls',
  'calls',
  'overview',
  'overview',
];

/** The Meadow's record: Emails, then Calls, then back to the Discussion. */
export function CrmRecordDemo() {
  let frame!: HTMLDivElement;
  const w = createDummyWorkspace('crm');
  w.open('crm', 'meadow');
  const [section, setSection] = createSignal<CompanySection>('overview');
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const playback = createProductWalkthrough({
    root: () => frame,
    steps: 6,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
      setSection('overview');
    },
    delay: (step) => (step === 1 ? 900 : step % 2 ? 1500 : 500),
    advance: (step) => {
      setPhase(step);
      const tab = tour[step];
      if (step % 2 === 0 && tab) setSection(tab);
      if (step === 6) {
        setAutomatic(false);
        // Back on Overview, bring the team's thread into view.
        requestAnimationFrame(() => {
          const scroll = frame.querySelector('.sample-company-scroll');
          scroll?.scrollTo?.({ top: scroll.scrollHeight, behavior: 'smooth' });
        });
      }
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  onMount(() => {
    const position = () => {
      const tab = tour[phase()];
      const target = tab
        ? frame.querySelector<HTMLElement>(`[data-record-tab="${tab}"]`)
        : undefined;
      if (!automatic() || !target) {
        setPointer(undefined);
        return;
      }
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      setPointer({
        x: bounds.left - parent.left + bounds.width / 2,
        y: bounds.top - parent.top + bounds.height * 0.7,
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
        label="The Meadow’s emails, calls, and team discussion in one record"
        onInteract={pause}
        height={520}
        mobileHeight={600}
      >
        <CrmRecordWorkspace
          workspace={w}
          section={section()}
          onSectionChange={setSection}
        />
      </ProductDemo>
      <Show when={automatic() && pointer()}>
        {(p) => (
          <DemoCursor
            label="Jacob"
            class="crm-demo-pointer"
            clicking={phase() % 2 === 0}
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

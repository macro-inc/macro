import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import type { SampleCompany } from '../../core/workspace-fixtures';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { CrmRecordWorkspace } from './CrmRecordWorkspace';

const kestrel: SampleCompany = {
  id: 'kestrel',
  name: 'Kestrel Robotics',
  domain: 'kestrel.example',
  description:
    'Kestrel Robotics designs autonomous inventory robots for mid-size warehouses and third-party logistics providers. The company is based in Pittsburgh and sells to operators across the US and Canada.',
  stage: 'No stage',
  owner: '',
  revenue: '',
  updated: '10:08 AM',
  lastInteracted: '2 minutes ago',
  unread: true,
  contacts: [{ name: 'Priya Shah', email: 'priya@kestrel.example' }],
  comments: [],
  emailIds: [],
  emails: [
    {
      id: 'kestrel-pricing',
      sender: 'Jacob Beckerman',
      subject: 'Re: Pricing for a 30-person team',
      snippet: 'Happy to walk you through it. Does Friday at 2 work?',
      time: '10:08 AM',
      signal: true,
      mine: true,
    },
  ],
};
const note: WorkspaceComment = {
  id: 'kestrel-note',
  person: 'jacob',
  body: 'Priya runs ops. They want 30 seats and need to be off HubSpot before January.',
  time: '10:11 AM',
};

/**
 * Jacob replies to someone new and the company appears in the list, already
 * described from public sources. He opens it and adds what only he knows.
 * Phases: 0 list, 1 new row, 2 pointer, 3 click, 4 record, 5 composer, 6 note.
 */
export function CrmEnrichmentDemo() {
  let frame!: HTMLDivElement;
  const w = createDummyWorkspace('crm');
  w.setCompanyLayout('List');
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const arrive = () => {
    if (!w.data.companies.some((company) => company.id === 'kestrel'))
      w.setData('companies', (companies) => [...companies, { ...kestrel }]);
  };
  const open = () => {
    arrive();
    w.setData('companies', (company) => company.id === 'kestrel', {
      unread: false,
    });
    w.open('crm', 'kestrel');
  };
  const finish = () => {
    open();
    w.setData('companies', (company) => company.id === 'kestrel', {
      comments: [note],
    });
  };
  const playback = createProductWalkthrough({
    root: () => frame,
    steps: 6,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
      finish();
    },
    delay: (step) => [0, 800, 1000, 400, 300, 1300, 800][step] ?? 1000,
    advance: (step) => {
      setPhase(step);
      if (step === 1) arrive();
      if (step === 4) open();
      if (step === 6) {
        finish();
        setAutomatic(false);
      }
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  onMount(() => {
    const position = () => {
      const selector = [
        undefined,
        undefined,
        '[data-company-row="kestrel"] .truncate',
        '[data-company-row="kestrel"] .truncate',
        undefined,
        '[data-discussion-composer]',
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
      setPointer({
        x: bounds.left - parent.left + Math.min(bounds.width * 0.6, 160),
        y: bounds.top - parent.top + bounds.height / 2,
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
        label="A company created from email, already described from public sources"
        onInteract={pause}
        height={450}
        mobileHeight={520}
      >
        <CrmRecordWorkspace workspace={w} />
      </ProductDemo>
      <Show when={automatic() && pointer()}>
        {(p) => (
          <DemoCursor
            label="Jacob"
            class="crm-demo-pointer"
            clicking={phase() === 3}
            style={{ transform: `translate(${p().x}px, ${p().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}

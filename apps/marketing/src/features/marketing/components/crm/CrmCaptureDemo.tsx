import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { demoMentions } from '../../core/demo-mentions';
import type { WorkspaceComment } from '../../core/dummy-workspace';
import type { SampleCompany } from '../../core/workspace-fixtures';
import { createCrmDemoWorkspace } from '../../primitives/createCrmDemoWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import type { ChannelComposerHandle } from '../email/frozen/ChannelComposer';
import { ProductDemo } from '../product/ProductPage';
import { CompanyPipelineEntry } from './CompanyPipelineEntry';
import { CrmRecordWorkspace } from './CrmRecordWorkspace';

const request: WorkspaceComment = {
  id: 'capture-request',
  person: 'jacob',
  body: '@[Claude](demo-mention:claude) just got off a call with Ava. They want a demo Thursday at 9 for the studio team. Move Parlor Studio to Demo, make me the owner, and note that Alex is running the rollout on their side.',
  time: '9:51 AM',
};
const reply: WorkspaceComment = {
  id: 'capture-reply',
  person: 'claude',
  body: 'Done. Parlor Studio is in Demo and you’re the owner. From the call: demo Thursday at 9 with the studio team, and Alex (alex@parlorstudio.example) is running the rollout on their side.',
  time: '9:52 AM',
  replyTo: 'capture-request',
};

/** Type and send a request, then show the agent's reply and property updates. */
export function CrmCaptureDemo() {
  let frame!: HTMLDivElement;
  let composer: ChannelComposerHandle | undefined;
  const w = createCrmDemoWorkspace();
  const meadow = (patch: Partial<SampleCompany>) =>
    w.setData('companies', (company) => company.id === 'meadow', patch);
  meadow({ comments: [] });
  const [deal, setDeal] = createStore<
    Pick<SampleCompany, 'stage' | 'owner' | 'revenue'>
  >({ stage: 'Lead', owner: '', revenue: '18000' });
  w.open('crm', 'meadow');
  const [phase, setPhase] = createSignal(0);
  const claude = demoMentions.find((item) => item.id === 'claude');
  const typing = demoTypingActions(
    request.body.replace('@[Claude](demo-mention:claude)', '@Claude'),
    (text) => composer?.setText(text, claude),
    1200
  );
  const sent = typing.length + 1;
  const acknowledgment: WorkspaceComment = {
    id: 'capture-working',
    person: 'claude',
    body: 'I’ll update the stage, owner, and rollout notes.',
    time: '9:51 AM',
    replyTo: request.id,
  };
  const scrollTo = (selector: string) => {
    queueMicrotask(() => {
      const scroll = frame.querySelector<HTMLElement>('.sample-company-scroll');
      const target = frame.querySelector<HTMLElement>(selector);
      if (scroll && target)
        scroll.scrollTop +=
          target.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top -
          16;
    });
  };
  const finish = () => {
    composer?.setText('');
    setDeal({ stage: 'Demo', owner: 'jacob' });
    meadow({ comments: [request, acknowledgment, reply] });
    setPhase(sent + 4);
  };
  const playback = createProductWalkthrough({
    root: () => frame,
    steps: sent + 4,
    loop: { hold: 8000 },
    reset: () => {
      composer?.setText('');
      setDeal({ stage: 'Lead', owner: '', revenue: '18000' });
      meadow({ comments: [] });
      setPhase(0);
      const scroll = frame.querySelector('.sample-company-scroll');
      if (scroll) scroll.scrollTop = 0;
    },
    reduced: finish,
    delay: (step) =>
      step < sent ? typing[step - 1].delay : step === sent ? 900 : 1400,
    advance: (step) => {
      setPhase(step);
      if (step < sent) {
        typing[step - 1].run();
        if (step === 1) scrollTo('[data-discussion-composer]');
      } else if (step === sent) {
        // Use the same send path as the visitor, then attach the scripted thread ID.
        composer?.send();
        meadow({ comments: [request] });
        scrollTo('[data-thread-id="capture-request"]');
      } else if (step === sent + 1) {
        meadow({ comments: [request, acknowledgment] });
      } else if (step === sent + 2) {
        setDeal({ stage: 'Demo' });
        scrollTo('.sample-pipeline-entries');
      } else if (step === sent + 3) {
        setDeal({ owner: 'jacob' });
      } else {
        finish();
        scrollTo('[data-thread-id="capture-request"]');
      }
    },
  });
  const pause = () => playback.pause();
  const action = () =>
    phase() === sent + 2 ? 'stage' : phase() === sent + 3 ? 'owner' : undefined;
  return (
    <div ref={frame} class="crm-demo-frame" onFocusIn={pause}>
      <ProductDemo
        label="Claude updates Parlor Studio from a comment in its Discussion"
        onInteract={pause}
        action={action()}
        height={600}
        mobileHeight={700}
      >
        <CrmRecordWorkspace
          richComposer
          workspace={w}
          onComposerReady={(handle) => {
            composer = handle;
          }}
          pipeline={<CompanyPipelineEntry value={deal} onChange={setDeal} />}
        />
      </ProductDemo>
    </div>
  );
}

import ArrowLeft from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { HomepageConversation } from '../HomepageConversation';
import { WorkspaceEmail } from '../workspace/WorkspaceEmail';
import '../email/email-demos.css';
import { WorkspaceCompanies } from '../workspace/WorkspaceCompanies';
import '../workspace/dummy-workspace.css';

const description =
  'Demo on Thursday. Alex is leading the rollout for The Meadow.';

/** The shared /demo company UI, with a local message-driven walkthrough. */
export function CrmCaptureDemo() {
  let root!: HTMLDivElement;
  let record!: HTMLDivElement;
  const workspace = createDummyWorkspace('crm');
  workspace.open('crm', 'meadow');
  workspace.setData('companies', (company) => company.id === 'meadow', {
    stage: 'Lead',
    owner: '',
    description: '',
    revenue: '',
    comments: [],
  });
  const [step, setStep] = createSignal(0);
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  const target = () =>
    step() < 3
      ? 'Deal stage'
      : step() < 4
        ? 'Company owner'
        : 'Company description';
  function positionPointer() {
    const field = record?.querySelector<HTMLElement>(
      `[aria-label="${target()}"]`
    );
    if (
      !playback.playing() ||
      !field ||
      !field.getClientRects().length ||
      step() === 0 ||
      step() >= 7
    ) {
      setPointer(undefined);
      return;
    }
    const bounds = field.getBoundingClientRect();
    const frame = record.getBoundingClientRect();
    setPointer({
      x: bounds.left - frame.left + Math.min(bounds.width - 12, 110),
      y: bounds.top - frame.top + bounds.height / 2,
    });
  }
  function advance(next: number) {
    setStep(next);
    const patch =
      next === 2
        ? { stage: 'Demo' as const }
        : next === 3
          ? { owner: 'jacob' as const }
          : next >= 4
            ? {
                description: description.slice(
                  0,
                  next === 4 ? 17 : next === 5 ? 43 : description.length
                ),
              }
            : {};
    workspace.setData('companies', (company) => company.id === 'meadow', patch);
    positionPointer();
  }
  const playback = createEmailWalkthrough({
    root: () => root,
    steps: 7,
    advance,
    reset: () => setStep(0),
    reduced: () => {
      workspace.setData('companies', (company) => company.id === 'meadow', {
        stage: 'Demo',
        owner: 'jacob',
        description,
      });
      setStep(7);
    },
  });
  const takeOver = () => {
    playback.pause();
    setPointer(undefined);
  };
  onMount(() => {
    const observer = new ResizeObserver(positionPointer);
    observer.observe(record);
    onCleanup(() => observer.disconnect());
  });
  return (
    <div
      ref={root}
      class="crm-capture-demo"
      role="group"
      aria-label="Claude updates a customer record from a message"
    >
      <HomepageConversation
        messages={[
          {
            person: 'jacob',
            text: 'Just spoke to Dana at The Meadow. They’re ready for a demo on Thursday. Assign the company to me and note that Alex is leading the rollout.',
          },
          {
            person: 'claude',
            text:
              step() >= 7
                ? 'Updated The Meadow: demo stage, assigned to you, and Alex’s role saved in the company notes.'
                : 'I’ll update the stage, owner, and notes on The Meadow.',
          },
        ]}
      />
      <div
        ref={record}
        class="crm-capture-record crm-record-demo glass-input"
        data-step={step()}
        onPointerDown={takeOver}
        onFocusIn={takeOver}
      >
        <div
          class="dummy-workspace workspace-demo portal-scope"
          data-theme="dark"
          data-embedded="true"
        >
          <div class="dummy-main">
            <Show
              when={workspace.view() === 'crm'}
              fallback={
                <>
                  <div class="px-3 pt-2">
                    <Button
                      variant="plain"
                      size="sm"
                      onClick={() => workspace.open('crm', 'meadow')}
                    >
                      <ArrowLeft />
                      Back to customer record
                    </Button>
                  </div>
                  <WorkspaceEmail
                    workspace={workspace}
                    tab="all"
                    account="all"
                  />
                </>
              }
            >
              <WorkspaceCompanies
                workspace={workspace}
                initialPanelOpen={
                  typeof window !== 'undefined' &&
                  window.matchMedia('(min-width: 700px)').matches
                }
              />
            </Show>
          </div>
        </div>
        <Show when={pointer()}>
          {(position) => (
            <div
              class="crm-capture-pointer"
              aria-hidden="true"
              style={{
                transform: `translate(${position().x}px, ${position().y}px)`,
              }}
            >
              <DemoCursor />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import { WorkspaceTasks } from '../workspace/WorkspaceTasks';
import { AgentAnswer, type AgentMention } from './AgentTranscript';
import { createDemoPointer } from './createDemoPointer';
import {
  NORTHWIND_COLLAB_PLAN,
  NORTHWIND_HUMAN_NOTE,
  NORTHWIND_PLAN,
  seedNorthwind,
} from './northwindScenario';
import './agent-stories.css';

/** The same native document presentation used by /demo. Both collaborators'
 * changes land in its local store. A visitor's first input owns the scene. */
export function NorthwindCollaboration() {
  const w = createDummyWorkspace('documents');
  seedNorthwind(w);
  w.open('documents', 'northwind-plan');
  let root!: HTMLDivElement;
  let frame!: HTMLDivElement;
  const [phase, setPhase] = createSignal(0);
  const [cursors, setCursors] = createSignal(true);
  let scrollFrame: number | undefined;
  onCleanup(() => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
  });
  const revealEdits = () => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!cursors()) return;
      const field = frame.querySelector<HTMLElement>(
        '[aria-label="Document body"]'
      );
      const scroller = field?.closest<HTMLElement>('.dummy-scroll');
      const heading = field?.querySelector('h2:nth-of-type(4)');
      if (!scroller || !heading) return;
      const top =
        scroller.scrollTop +
        heading.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        100;
      scroller.scrollTo?.({ top: Math.max(0, top), behavior: 'smooth' });
    });
  };
  const write = (body: string) =>
    w.setData('documents', (d) => d.id === 'northwind-plan', 'body', body);
  const finish = () => {
    write(NORTHWIND_COLLAB_PLAN + NORTHWIND_HUMAN_NOTE);
    setPhase(4);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    delay: () => 1300,
    reduced: () => {
      finish();
      setCursors(false);
    },
    advance: (step) => {
      setPhase(step);
      if (step === 1)
        write(
          NORTHWIND_PLAN +
            '\n\n## Customer coordination\n\nMarcus will send the pilot names.'
        );
      if (step === 2)
        write(
          NORTHWIND_COLLAB_PLAN +
            '\n\n## Customer coordination\n\nMarcus will send the pilot names.'
        );
      if (step === 3) finish();
      if (step === 4) setCursors(false);
      else revealEdits();
    },
  });
  const pause = () => {
    playback.pause();
    setCursors(false);
  };
  const agent = createDemoPointer({
    frame: () => frame,
    target: () =>
      cursors() && phase() >= 1
        ? '[aria-label="Document body"] h2:nth-of-type(4)'
        : undefined,
  });
  const person = createDemoPointer({
    frame: () => frame,
    target: () =>
      cursors() && phase() >= 1
        ? '[aria-label="Document body"] p:last-of-type'
        : undefined,
  });
  const mentions: Record<string, AgentMention> = {
    sso: { kind: 'task', onOpen: () => w.open('tasks', 'northwind-sso') },
    training: {
      kind: 'task',
      onOpen: () => w.open('tasks', 'northwind-training'),
    },
  };

  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="People and agents editing the Northwind rollout plan"
      height={540}
      mobileHeight={640}
      onInteract={pause}
    >
      <div ref={frame} class="agent-collaboration-frame">
        <Show
          when={w.view() !== 'tasks'}
          fallback={<WorkspaceTasks workspace={w} filter="all" />}
        >
          <Show
            when={w.view() !== 'messages'}
            fallback={<WorkspaceChannel workspace={w} />}
          >
            <WorkspaceDocuments
              workspace={w}
              relatedContent={
                <div class="mt-6">
                  <AgentAnswer
                    text="Related work: @[SSO verification](agent:sso) · @[Training for 40 people](agent:training)"
                    mentions={mentions}
                  />
                </div>
              }
            />
          </Show>
        </Show>
        <Show
          when={w.view() !== 'documents' || w.selected() !== 'northwind-plan'}
        >
          <Button
            variant="plain"
            size="icon-sm"
            class="agent-split-close"
            label="Back to rollout plan"
            onClick={() => w.open('documents', 'northwind-plan')}
          >
            <X class="size-4" />
          </Button>
        </Show>
        <Show when={agent()}>
          {(point) => (
            <DemoCursor
              label="Claude"
              class="agent-demo-pointer"
              style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
            />
          )}
        </Show>
        <Show when={person()}>
          {(point) => (
            <DemoCursor
              label="Jacob"
              class="agent-demo-pointer"
              style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
            />
          )}
        </Show>
      </div>
    </ProductDemo>
  );
}

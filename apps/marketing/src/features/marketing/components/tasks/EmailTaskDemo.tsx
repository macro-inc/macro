import TaskIcon from '@icon/system/regular/list-checks.svg';
import AskIcon from '@icon/system/regular/sparkle.svg';
import X from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { demoTypingActions } from '../../primitives/demoTypingActions';
import { createDemoPointer } from '../agents/createDemoPointer';
import { DemoCursor } from '../DemoCursor';
import { DocMention } from '../documents/DocMention';
import { EmailThread } from '../email/frozen/EmailThread';
import { ProductDemo } from '../product/ProductPage';
import { TaskComposer } from '../workspace/frozen/TaskComposer';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import { createProposalWorkspace, PROPOSAL_TASK } from './proposalWorkspace';
import './task-context.css';
import './task-creation-flow.css';
import './email-task-demo.css';

type Phase = 'email' | 'composing' | 'created';

const emptyDraft: WorkspaceTask = {
  id: 'task-draft',
  title: '',
  description: '',
  owner: 'julia',
  creator: 'jacob',
  priority: 'Medium',
  status: 'Not Started',
  channel: 'sales',
  tags: [],
  steps: [],
  comments: [],
};

/**
 * A customer email becomes a task: the email's task button opens the task
 * composer with the email already mentioned, and the new task opens beside
 * the email it links to.
 */
export function EmailTaskDemo() {
  let root!: HTMLDivElement;
  const w = createProposalWorkspace();
  const email = () => w.data.emails.find((item) => item.id === 'dana')!;
  const task = () => w.data.tasks.find((item) => item.id === 'proposal')!;
  const [phase, setPhase] = createSignal<Phase>('email');
  const [emailOpen, setEmailOpen] = createSignal(true);
  const [narrow, setNarrow] = createSignal(true);
  const [automatic, setAutomatic] = createSignal(true);
  const [target, setTarget] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const [draft, setDraft] = createStore<WorkspaceTask>({ ...emptyDraft });

  const create = (title = draft.title) => {
    w.updateTask('proposal', {
      title: title.trim() || PROPOSAL_TASK,
      description: '',
      owner: draft.owner,
      priority: draft.priority,
      status: draft.status,
      tags: [],
      relatedDocumentIds: [],
    });
    // Beside the task where there is room; on a narrow frame it would cover it.
    setEmailOpen(!narrow());
    setPhase('created');
  };

  const approach = (selector: string) => {
    setClicking(false);
    setTarget(selector);
  };
  const click = (run: () => void) => {
    setClicking(true);
    run();
  };
  // Delays are reading or movement time before the named action.
  const actions = [
    { delay: 1500, run: () => approach('[data-email-task-button]') },
    { delay: 700, run: () => click(() => setPhase('composing')) },
    ...demoTypingActions(
      PROPOSAL_TASK,
      (title) => {
        setClicking(false);
        setDraft('title', title);
      },
      600
    ),
    { delay: 700, run: () => approach('[data-task-submit]') },
    { delay: 650, run: () => click(() => create()) },
    { delay: 500, run: () => setClicking(false) },
  ];
  const playback = createProductWalkthrough({
    root: () => root,
    steps: actions.length,
    loop: { hold: 6500 },
    reset: () => {
      setDraft({ ...emptyDraft });
      setPhase('email');
      setEmailOpen(true);
      setAutomatic(true);
      setTarget(undefined);
      setClicking(false);
    },
    reduced: () => {
      create(PROPOSAL_TASK);
      setAutomatic(false);
    },
    onTakeover: () => setAutomatic(false),
    delay: (step) => actions[step - 1].delay,
    advance: (step) => actions[step - 1].run(),
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target,
    active: automatic,
  });

  onMount(() => {
    const measure = () => setNarrow(root.clientWidth < 760);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    onCleanup(() => observer.disconnect());
  });

  const emailMention = () => (
    <DocMention item={{ kind: 'email', label: email().subject }} />
  );

  return (
    <ProductDemo
      label="Create a task from a customer email"
      onInteract={pause}
      height={540}
      mobileHeight={560}
    >
      <div
        ref={root}
        class="task-context-layout email-task-demo"
        data-narrow={narrow()}
        data-source-open={phase() === 'created' && emailOpen()}
      >
        <Show when={phase() === 'created'}>
          <div class="task-context-primary dummy-main">
            <TaskNotebook
              workspace={w}
              task={task()}
              hideCollectionNavigation
              sourceContent={<span />}
              descriptionContent={
                <p class="task-context-reference">
                  <button
                    type="button"
                    class="task-context-mention"
                    aria-label={`Open ${email().subject}`}
                    onClick={() => {
                      pause();
                      setEmailOpen(true);
                    }}
                  >
                    {emailMention()}
                  </button>
                </p>
              }
            />
          </div>
        </Show>
        <Show when={phase() !== 'created' || emailOpen()}>
          <section
            class="task-context-source dummy-main"
            aria-label="Customer email"
          >
            <div class="dummy-scroll sample-email-thread">
              <EmailThread
                email={email()}
                hideReply
                actions={
                  <div
                    class="email-task-actions"
                    role="group"
                    aria-label="Actions"
                  >
                    <Button
                      variant="plain"
                      size="icon-sm"
                      label="Ask Macro"
                      tabIndex={-1}
                    >
                      <AskIcon />
                    </Button>
                    <Button
                      variant="plain"
                      size="icon-sm"
                      label="Create task"
                      data-email-task-button=""
                      onClick={() => {
                        pause();
                        setDraft({ ...emptyDraft });
                        setPhase('composing');
                      }}
                    >
                      <TaskIcon />
                    </Button>
                  </div>
                }
              />
            </div>
            <Show when={phase() === 'created' && narrow()}>
              <Button
                class="task-context-close"
                label="Close email"
                variant="plain"
                size="icon-sm"
                onClick={() => setEmailOpen(false)}
              >
                <X />
              </Button>
            </Show>
          </section>
        </Show>
        <Show when={phase() === 'composing'}>
          <div class="task-flow-popover">
            <TaskComposer
              draft={draft}
              source={emailMention()}
              update={(patch) => setDraft(patch)}
              submit={() => {
                pause();
                create();
              }}
              close={() => {
                pause();
                setPhase('email');
              }}
            />
          </div>
        </Show>
        <Show when={automatic() && pointer()}>
          {(point) => (
            <DemoCursor
              class="task-context-pointer"
              clicking={clicking()}
              style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
            />
          )}
        </Show>
      </div>
    </ProductDemo>
  );
}

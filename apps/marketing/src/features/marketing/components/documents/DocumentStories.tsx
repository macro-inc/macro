import ListChecks from '@phosphor/list-checks.svg';
import { createSignal, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { HomepageConversation } from '../HomepageConversation';
import { ProductDemo } from '../product/ProductPage';
import { ProductShareDialog } from '../product/ProductShareDialog';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { WorkspaceDocuments } from '../workspace/WorkspaceDocuments';
import '../workspace/dummy-workspace.css';
import '../demo-markdown.css';

const draft =
  '## Thursday’s launch\n\nWe’re introducing the team workspace on Thursday. The invite flow and announcement need a final check.';
const finished =
  '## Thursday’s launch\n\nBring the team’s emails, messages, and tasks into one workspace.\n\n## Before we publish\n\n- Teo: verify the invite flow.\n- Julia: review the announcement.\n- Jacob: confirm the final launch checks.';
function documentWorkspace() {
  const w = createDummyWorkspace('documents');
  w.open('documents', 'plan');
  w.setData('documents', (d) => d.id === 'plan', { body: draft, comments: [] });
  return w;
}

export function DocumentEditingDemo() {
  let root!: HTMLDivElement;
  const w = documentWorkspace();
  const [editing, setEditing] = createSignal(false);
  const finish = () =>
    w.setData('documents', (d) => d.id === 'plan', 'body', finished);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    advance: (s) => {
      if (s === 1) setEditing(true);
      if (s === 2) finish();
      if (s === 3) setEditing(false);
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Edit the working launch document"
      action={editing() ? 'document' : undefined}
      onInteract={playback.pause}
    >
      <WorkspaceDocuments workspace={w} />
    </ProductDemo>
  );
}

export function DocumentAgentDemo() {
  let root!: HTMLDivElement;
  const w = documentWorkspace();
  const [editing, setEditing] = createSignal(false);
  const finish = () => {
    w.setData('documents', (d) => d.id === 'plan', 'body', finished);
    setEditing(false);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 4,
    reset: () => {},
    reduced: finish,
    advance: (s) => {
      if (s === 1) setEditing(true);
      if (s === 2) finish();
    },
  });
  return (
    <div ref={root} onPointerDown={playback.pause} onKeyDown={playback.pause}>
      <div class="product-demo-request">
        <HomepageConversation
          messages={[
            {
              person: 'julia',
              text: '@Claude, make the launch introduction shorter and add a checklist with Teo, Julia, and Jacob’s next steps.',
            },
          ]}
        />
      </div>
      <ProductDemo
        label="An agent edits the same document"
        onInteract={playback.pause}
        action={editing() ? 'document' : undefined}
      >
        <WorkspaceDocuments workspace={w} />
        <Show when={editing()}>
          <div class="product-editing-pointer" aria-hidden="true">
            <svg viewBox="0 0 16 20">
              <path d="M2 1v15l4-4 3 7 3-1-3-7h6Z" fill="currentColor" />
            </svg>
            <span>Claude</span>
          </div>
        </Show>
      </ProductDemo>
    </div>
  );
}

export function DocumentDiscussionDemo() {
  const w = documentWorkspace();
  w.setData('documents', (d) => d.id === 'plan', {
    body: '## Announcement wording\n\nBring your team’s emails, messages, and tasks into one workspace.',
    comments: [
      {
        id: 'wording',
        person: 'teo',
        body: 'Can we make the invite flow explicit? That’s what changes for existing teams.',
        time: '9:40 AM',
      },
      {
        id: 'answer',
        person: 'julia',
        body: 'Yes. I’ll add that in the next paragraph before publishing.',
        time: '9:42 AM',
      },
    ],
  });
  return (
    <ProductDemo label="Discuss the document alongside its content">
      <WorkspaceDocuments workspace={w} />
    </ProductDemo>
  );
}

export function DocumentLinkedTaskDemo() {
  const w = documentWorkspace();
  return (
    <ProductDemo label="Open the task linked to the document">
      <Show
        when={w.contentView() === 'documents'}
        fallback={<ProductWorkspace workspace={w} />}
      >
        <WorkspaceDocuments
          workspace={w}
          relatedContent={
            <div class="mt-6">
              <button
                type="button"
                class="dummy-entity-link"
                onClick={() => w.open('tasks', 'checklist')}
              >
                <ListChecks class="size-4 text-task" />
                Prepare the launch checklist
              </button>
            </div>
          }
        />
      </Show>
    </ProductDemo>
  );
}

/** The native Share flow, isolated from real document access. */
export function DocumentSharingDemo() {
  const w = documentWorkspace();
  const [open, setOpen] = createSignal(false);
  return (
    <ProductDemo label="Share a working document with a teammate">
      <WorkspaceDocuments workspace={w} onShare={() => setOpen(true)} />
      <ProductShareDialog
        open={open()}
        title="Q3 launch plan"
        onClose={() => setOpen(false)}
      />
    </ProductDemo>
  );
}

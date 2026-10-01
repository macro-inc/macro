import Sidebar from '@phosphor/sidebar-simple.svg';
import { createMediaQuery } from '@solid-primitives/media';
import { createSignal, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { ProductDemo } from '../product/ProductPage';
import { ProductWorkspace } from '../product/ProductWorkspace';
import { TaskFromMessageDemo } from '../tasks/TaskStories';
import { WorkspaceSidebar } from '../workspace/WorkspaceSidebar';
import '../workspace/dummy-workspace.css';

export { TaskFromMessageDemo as ChannelTaskDemo };

export function ChannelSharedWorkDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'plan-request',
      person: 'julia',
      body: 'Here’s the Thursday launch plan. Can you check the owners before we share it?',
      time: '9:15 AM',
      documentId: 'plan',
    },
    {
      id: 'plan-reply',
      person: 'teo',
      body: 'I’ll check the invite flow and add the last details there.',
      time: '9:17 AM',
    },
  ]);
  const open = () => w.open('documents', 'plan');
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: open,
    advance: (step) => {
      if (step === 2) open();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Open a document shared in a channel"
      onInteract={playback.pause}
    >
      <ProductWorkspace workspace={w} />
    </ProductDemo>
  );
}

export function ChannelAgentDemo() {
  let root!: HTMLDivElement;
  const w = createDummyWorkspace('messages');
  const initial = [
    {
      id: 'decision',
      person: 'teo' as const,
      body: 'The invite fix is in progress. I’m taking it; Julia has the announcement. The launch is Thursday.',
      time: '9:20 AM',
    },
    {
      id: 'catchup',
      person: 'jacob' as const,
      body: '@Claude, catch me up on the launch decisions and who owns the work.',
      time: '9:28 AM',
    },
  ];
  w.setData('channels', (c) => c.id === 'launch', 'messages', initial);
  const finish = () =>
    w.setData('channels', (c) => c.id === 'launch', 'messages', [
      ...initial,
      {
        id: 'agent-summary',
        person: 'claude',
        body: 'Thursday’s launch is the target. Teo owns the invite fix; Julia owns the announcement. The invite task is still in progress.',
        time: '9:29 AM',
        taskId: 'invite',
      },
    ]);
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 3,
    reset: () => {},
    reduced: finish,
    advance: (s) => {
      if (s === 2) finish();
    },
  });
  return (
    <ProductDemo
      ref={(el) => (root = el)}
      label="Catch up with an agent using the channel context"
      onInteract={playback.pause}
    >
      <ProductWorkspace workspace={w} />
    </ProductDemo>
  );
}

export function ChannelThreadDemo() {
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'root',
      person: 'julia',
      body: 'Can we confirm the announcement wording here before publishing?',
      time: '9:30 AM',
      documentId: 'plan',
    },
    {
      id: 'reply-1',
      person: 'teo',
      body: 'Yes. Keep the invite flow in the first paragraph.',
      time: '9:32 AM',
      replyTo: 'root',
    },
    {
      id: 'reply-2',
      person: 'jacob',
      body: 'Agreed. The team should see what changes for them.',
      time: '9:34 AM',
      replyTo: 'root',
    },
    {
      id: 'next',
      person: 'julia',
      body: 'The product demo is ready too. I’ll add it to the launch plan.',
      time: '9:38 AM',
    },
  ]);
  return (
    <ProductDemo label="Expand a thread and reply in place">
      <ProductWorkspace workspace={w} />
    </ProductDemo>
  );
}

export function ChannelNavigationDemo() {
  const [collapsed, setCollapsed] = createSignal(false);
  const mobile = createMediaQuery('(max-width: 699px)');
  const w = createDummyWorkspace('messages');
  return (
    <ProductDemo label="Find channels and direct messages">
      <div class="product-sidebared-scene">
        <Show when={!collapsed()}>
          <WorkspaceSidebar
            workspace={w}
            title="Chat"
            collapse={() => setCollapsed(true)}
            create={() => {}}
            navigate={(view, id) => {
              w.open(view, id);
              if (mobile()) setCollapsed(true);
            }}
            taskFilter="all"
            setTaskFilter={() => {}}
          />
        </Show>
        <div class="dummy-main">
          <Show when={collapsed()}>
            <button
              type="button"
              aria-label="Show chat navigation"
              class="px-4 py-2 text-left"
              onClick={() => setCollapsed(false)}
            >
              <Sidebar class="size-4" />
            </button>
          </Show>
          <ProductWorkspace workspace={w} />
        </div>
      </div>
    </ProductDemo>
  );
}

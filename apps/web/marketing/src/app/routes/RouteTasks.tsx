import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../../features/marketing/components/product/ProductPage';
import {
  TaskAgentDemo,
  TaskAttentionDemo,
  TaskContextDemo,
  TaskFromMessageDemo,
  TaskOwnershipDemo,
} from '../../features/marketing/components/tasks/TaskStories';
import {
  TaskAgentsGraphic,
  TaskConversationGraphic,
  TaskListGraphic,
  TaskPropertiesGraphic,
} from '../../features/marketing/components/tasks/TasksFeatureGraphics';
import { WorkspaceDesktopDemo } from '../../features/marketing/components/WorkspaceDesktopDemo';
import { setPageSeo } from '../utils/utilSeo';

const tasksFaq = [
  {
    q: 'How is Macro Tasks different from Linear?',
    a: (
      <>
        Macro keeps status, priority, assignees, and a keyboard-first workflow
        alongside email, chat, and documents. Tasks stay connected to the
        conversations behind them. Read the{' '}
        <a href="/posts/linear-alternative">Macro and Linear comparison</a>.
      </>
    ),
  },
  {
    q: 'Can I turn a message or email into a task?',
    a: 'Yes. Create a task from a chat message or email and keep it linked to the original conversation. You can also mention the task in documents and channels.',
  },
  {
    q: 'How do I organize my tasks?',
    a: 'Use My Tasks, All Tasks, and Created by me to find the work you need. Set status, priority, and assignees, add tags, and search the task list.',
  },
  {
    q: 'Can agents work on tasks?',
    a: (
      <>
        Assign work to an agent in a conversation. Agents can use the available
        workspace context, update the task, and report back. Coding agents can
        work on a fix and open a pull request. See{' '}
        <a href="/agents">agents in Macro</a>.
      </>
    ),
  },
  {
    q: 'Does Macro integrate with GitHub?',
    a: (
      <>
        Yes. Link tasks to branches and pull requests to track the code
        alongside the work. Opening a linked pull request moves the task to In
        Review; merging it completes the task. See the{' '}
        <a href="/github">GitHub integration</a>.
      </>
    ),
  },
  {
    q: 'Can people outside engineering use it?',
    a: 'Yes. Tasks work for launch plans, customer follow-ups, and other team work. Teammates can follow progress alongside their email, chat, and documents.',
  },
  {
    q: 'Is our workspace public because Macro is open source?',
    a: (
      <>
        No. Open source makes the application code available to inspect. It does
        not make your tasks, messages, or documents public. Access to workspace
        content follows its sharing permissions.
      </>
    ),
  },
  {
    q: 'Is there a free plan?',
    a: (
      <>
        Yes. Tasks are included alongside email, chat, documents, and AI. See{' '}
        <a href="/pricing">pricing</a> for current usage limits.
      </>
    ),
  },
];

export function RouteTasks() {
  setPageSeo({
    title: 'Macro Tasks — Task management that keeps up with your team',
    description:
      'Track tasks alongside your email, chat, and documents. Create work from conversations, assign people and agents, and follow progress through to a pull request.',
    path: '/tasks',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Tasks"
        title={['Tasks for your team', 'and your agents.']}
        description={[
          'Create tasks from messages and email.',
          'Assign an owner. Let agents update the work.',
        ]}
        cta="tasks_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="tasks"
        label="Explore Macro Tasks"
        caption="Open a task, change its owner, or add a comment. This sample stays local."
      />
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#from-conversation">
          <TaskConversationGraphic />
          <span>From a message</span>
        </a>
        <a href="#task-properties">
          <TaskPropertiesGraphic />
          <span>Clear ownership</span>
        </a>
        <a href="#task-agents">
          <TaskAgentsGraphic />
          <span>Work with agents</span>
        </a>
        <a href="#task-list">
          <TaskListGraphic />
          <span>Your next action</span>
        </a>
      </nav>
      <FeaturePageSection
        id="from-conversation"
        title="Turn a message into a task."
        description={
          'Create a task from a message or email.\nIts source stays linked in both directions.'
        }
      >
        <div class="feature-page-visual">
          <TaskFromMessageDemo />
        </div>
        <ProductProse>
          <p>
            A task can start from a chat message, email, or document checklist.
            References connect it to the original request, and backlinks let you
            navigate back.
          </p>
          <p>
            For a new task, press C then T. Add a title, description, and
            assignee from the keyboard.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="task-properties"
        title="Owner, status, priority."
        description={
          'Assign a person or agent and set the priority.\nUpdate the status directly from the task or list.'
        }
      >
        <div class="feature-page-visual">
          <TaskOwnershipDemo />
        </div>
        <ProductProse>
          <p>
            Tasks have assignees, status, priority, and tags. Those properties
            appear in the task list and in rich task references across Macro.
          </p>
          <p>
            Your team can see who is responsible and whether the work is
            started, in review, or complete. The same fields are available to
            agents through task tools.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="task-context"
        title="An editable brief with real references."
        description={
          'Write a Markdown brief and checklist.\n@mention the specification, email, or call that explains the request.'
        }
      >
        <div class="feature-page-visual">
          <TaskContextDemo />
        </div>
        <ProductProse>
          <p>
            Task descriptions support Markdown and references to workspace
            items. Link the specification, source email, or meeting recording
            directly in the brief.
          </p>
          <p>
            Each task has a discussion for questions and updates. Agents can
            read the brief, follow its references, and update the description.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="task-agents"
        title="Agents can update the task."
        description={
          'Ask an agent to revise the brief or turn meeting notes into a checklist.\nIts edits appear in the task your team uses.'
        }
      >
        <div class="feature-page-visual">
          <TaskAgentDemo />
        </div>
        <ProductProse>
          <p>
            Task tools let agents create work and update descriptions, status,
            priority, and assignees. Ask for a specific change and review it in
            the task.
          </p>
          <p>
            Coding agents can implement a task and open a linked pull request.
            GitHub events move the task into review and mark it complete when
            the code is merged.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="task-list"
        title="My Tasks. All Tasks. Created by me."
        description={
          'Find your assigned work, browse the team’s tasks, or follow your requests.\nSearch by title and open the brief from the list.'
        }
      >
        <div class="feature-page-visual">
          <TaskAttentionDemo />
        </div>
        <ProductProse>
          <p>
            My Tasks shows your assignments. All Tasks shows the work you can
            access, and Created by me tracks the requests you made.
          </p>
          <p>
            Task assignments also arrive in the unified inbox, alongside emails,
            messages, and agent responses. Open one to read the brief or update
            its properties.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="tasks-faq-title"
        eyebrow="Creation, ownership, and automation"
        title="How Macro Tasks work."
        introduction={
          <p>
            Keyboard-first tasks, bidirectional references, agent tools, and
            GitHub status updates.
          </p>
        }
        items={tasksFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}

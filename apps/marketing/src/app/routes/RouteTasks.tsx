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
  TaskFromChannelDemo,
  TaskFromMessageDemo,
} from '../../features/marketing/components/tasks/TaskStories';
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
      <section
        class="tasks-founder-letter"
        aria-labelledby="tasks-founder-title"
      >
        <h2 id="tasks-founder-title">Why did we build Macro Tasks?</h2>
        <p>
          Macro Tasks was designed based off our frustration with tools like
          Linear, Notion and Jira... we've tried every task manager and every
          way of using them. None of them helped our team move faster. Each kept
          us organized for a while until they inevitably got stale. The core
          problem is “tracking tasks” felt like busywork to our team. We
          migrated from GitHub Issues to Notion to Linear and nothing seemed to
          make us more organized.
        </p>
        <p>
          Macro Tasks fixes this by tightly co-locating tasks with your team
          chat. Tickets are so easy to create from task messages, and their
          status gets updated automatically so they'll actually get closed.
          After two years of dogfooding it's finally working for us. We hope you
          like it too!
        </p>
        <footer>— Jacob Beckerman, CEO and founder of Macro</footer>
      </section>
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
            navigate back. For a new task, press C then T. Add a title,
            description, and assignee from the keyboard.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="tasks-in-channels"
        title="Send a task right in the channel."
        description={
          'Write the request, switch on Send as task, and pick an assignee.\nThe task appears in the conversation where your team is working.'
        }
      >
        <div class="feature-page-visual">
          <TaskFromChannelDemo />
        </div>
        <ProductProse>
          <p>
            Send a channel message as a task to create the brief and share it in
            one action. Choose an assignee before sending. Teammates can open
            the task from its message to change the status, add a checklist, or
            discuss the request. The task links back to the channel, and the
            assignee receives it in their inbox.
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
            directly in the brief. Each task has a discussion for questions and
            updates. Agents can read the brief, follow its references, and
            update the description.
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
            the task. Coding agents can implement a task and open a linked pull
            request. GitHub events move the task into review and mark it
            complete when the code is merged.
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
            access, and Created by me tracks the requests you made. Task
            assignments also arrive in the unified inbox, alongside emails,
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

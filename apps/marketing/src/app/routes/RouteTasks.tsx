import { DemoInteractionBoundary } from '../../features/marketing/components/DemoInteractionBoundary';
import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import {
  ProductHero,
  ProductPage,
} from '../../features/marketing/components/product/ProductPage';
import { TaskPaperGraphic } from '../../features/marketing/components/tasks/TaskPaperGraphic';
import {
  TaskAgentChannelDemo,
  TaskGithubDemo,
} from '../../features/marketing/components/tasks/TaskStories';
import { TasksComparison } from '../../features/marketing/components/tasks/TasksComparison';
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import '../../features/marketing/components/tasks/tasks-page.css';
import { setPageSeo } from '../utils/utilSeo';

const tasksFaq = [
  {
    q: 'Can I group tasks into projects?',
    a: (
      <>
        Open the Projects tab in Tasks to group work with a shared description,
        discussion, and assignees. A task belongs to one project at a time.
        Deleting a project keeps its tasks. See{' '}
        <a href="/tasks#guide-projects">project setup</a>.
      </>
    ),
  },
  {
    q: 'How do I create and assign a task?',
    a: 'Create a task in Tasks or from a message. Give it a title, assign a person or available agent, and set its status and priority. Keep relevant files and conversations linked to the task.',
  },
  {
    q: 'Can I import existing tasks?',
    a: (
      <>
        You can import Linear issues or task CSVs. See{' '}
        <a href="/docs/switch-to-macro">migration options</a>, or{' '}
        <a href={DEMO_BOOKING_URL}>talk to our team</a> about moving your
        company’s work.
      </>
    ),
  },
  {
    q: 'Where do I see my tasks and the work I’ve assigned?',
    a: 'My Tasks shows your assignments. Created by me shows tasks you created, and All Tasks shows tasks you can access. Filter by owner, status, or priority.',
  },
  {
    q: 'Can an agent work on a task?',
    a: (
      <>
        Yes. Assign an available agent to start an agent session and open that
        session from the task to follow its work. You can also ask an agent to
        create or update tasks. See <a href="/agents">Rox Agents</a>.
      </>
    ),
  },
  {
    q: 'What updates automatically?',
    a: (
      <>
        Task mentions show the current title and status. Linked pull requests
        move tasks into review and complete them when merged. Other progress is
        updated by people or agents. See the{' '}
        <a href="/github">GitHub integration</a>.
      </>
    ),
  },
  {
    q: 'Who can see a task?',
    a: 'Tasks follow their sharing settings. In the task composer, choose whether to share with your team or keep access limited to yourself and the people you share it with.',
  },
  {
    q: 'Can I try Rox for free?',
    a: (
      <>
        Yes. Rox has a free plan with usage limits. See{' '}
        <a href="/pricing">plans and limits</a> for details.
      </>
    ),
  },
];

export function RouteTasks() {
  setPageSeo({
    title: 'Rox Tasks — Task management for people and agents',
    description:
      'Create tasks from messages, email, or documents without leaving your work. Assign people or agents, keep the original context linked, and let GitHub pull requests update task status.',
    path: '/tasks',
  });
  return (
    <ProductPage>
      <div class="tasks-page">
        <ProductHero
          tutorialBackdrop
          cta="tasks_hero_get_started"
          tutorial="tasks"
          product="Tasks"
          title="Tasks for people and agents."
          description="Create tasks from email and team chat. Assign people or agents, and keep task status in sync with linked pull requests."
        />
        <FeaturePageSection
          id="from-a-message"
          title="Create and assign tasks."
          description="Tasks are quick to create, assign, prioritize and close with keyboard shortcuts. Give it a title, assign a person or available agent, and set its status and priority. Hover any message and click Create task to spin one up, linked to that thread. Or use the shortcut C then T to create a task from wherever you are."
        >
          <TaskPaperGraphic kind="tasks" />
        </FeaturePageSection>
        <FeaturePageSection
          id="ask-macro"
          demo={{
            tone: 'tasks',
            glassFrame: true,
          }}
          title="Ask Rox to create tasks."
          description="Mention @Rox in Rox Chat and ask it to create tasks from what was just said. It assigns the work and links the tasks back to the conversation. You can also assign an available agent to a task and open its session to follow the work. Through Rox’s MCP server, Claude Code, Codex, and Cursor can find, create, and update your tasks without leaving your editor."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskAgentChannelDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="from-docs-and-email"
          title="Link tasks to the work behind them."
          description="Every task is linked back to its source bidirectionally — the task remembers where it came from and the source knows the task exists. Create one from a customer email, or highlight to-do boxes in a document to create several at once. @mention a task in a doc, email, or channel: the live pill stays in sync with its title and status. Click it to jump straight to the task."
        >
          <TaskPaperGraphic kind="properties" />
        </FeaturePageSection>
        <FeaturePageSection
          id="task-views"
          title="See your team’s tasks."
          description="My Tasks shows your assignments. Created by me shows tasks you created, and All Tasks shows tasks you can access. Filter what shows, switch between a list, a board and a Gantt chart, and sort or group your tasks. You can also ask your agent to give you updates on your team’s tasks."
        >
          <TaskPaperGraphic kind="views" />
        </FeaturePageSection>
        <FeaturePageSection
          id="github"
          demo={{
            tone: 'tasks',
            glassFrame: true,
          }}
          title="Update task status from GitHub."
          description="As you create, review, and merge pull requests, the linked task moves through In Progress, In Review, and Completed. The task records which pull request is associated with it. Click the GitHub pill to open the pull request from the task, or go back to the task from the pull request. Your team can see where the work stands without you having to update two systems."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskGithubDemo />}
          />
        </FeaturePageSection>
        <TasksComparison />
        <FeaturePageFaq
          guide={{ href: '/tasks#guide', label: 'tasks' }}
          id="tasks-faq-title"
          title="Questions about Rox Tasks"
          items={tasksFaq}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}

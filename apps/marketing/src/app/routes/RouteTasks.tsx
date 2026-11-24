import {
  FeaturePageFaq,
  FeaturePageSection,
} from '../../features/marketing/components/FeaturePage';
import { HomepageClosing } from '../../features/marketing/components/HomepageClosing';
import {
  ProductHero,
  ProductPage,
} from '../../features/marketing/components/product/ProductPage';
import { TasksComparison } from '../../features/marketing/components/tasks/TasksComparison';
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import '../../features/marketing/components/tasks/tasks-page.css';
import { FeaturePhoneScreens } from '../../features/marketing/components/FeatureScreenshot';
import {
  featureScreens,
  phoneScreens,
} from '../../features/marketing/core/feature-screens';
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
        create or update tasks. See <a href="/agents">Macro Agents</a>.
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
    q: 'Can I try Macro for free?',
    a: (
      <>
        Yes. Macro has a free plan with usage limits. See{' '}
        <a href="/pricing">plans and limits</a> for details.
      </>
    ),
  },
];

export function RouteTasks() {
  setPageSeo({
    title: 'Macro Tasks — Task management for people and agents',
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
          title="Turn conversations into tasks."
          description="Create tasks from email and team chat. Assign people or agents, and keep task status in sync with linked pull requests."
        />
        <FeaturePageSection
          id="from-a-message"
          title="Create tasks right from Macro Chat."
          description="Turn any Macro Chat message into a task with the original thread deep-linked, or mention @Macro to spin up multiple tasks from a discussion. Press C then T from anywhere."
          screen={featureScreens['from-a-message']}
        />
        <FeaturePageSection
          id="from-docs-and-email"
          title="Directly linked to customer Macro Mail."
          description="Create tasks from Macro Mail or highlight checklists in Macro Docs to generate them in bulk. Every task links back to its source, and pasting one in chat shows live status, assignee, and priority."
          screen={featureScreens['from-docs-and-email']}
        />
        <FeaturePageSection
          id="task-agents"
          title="Assign tasks to Macro Agents, like teammates."
          description="Assign a task to Macro Agents just like a teammate and follow its live session. Over MCP, Claude Code, Codex, and Cursor can search, create, and update your tasks straight from your editor."
          screen={featureScreens['task-agents']}
        />
        <FeaturePageSection
          id="github"
          title="Linked to Macro GitHub, both ways."
          description="Opening, reviewing, and merging a Macro GitHub PR moves the linked task through In Progress, In Review, and Completed automatically—no updating two systems."
          screen={featureScreens['github']}
        />
        <FeaturePageSection
          id="task-projects"
          title="Projects and tags."
          description="Group work with an owner and finish line into Projects, and use Macro Tags for everything that cuts across teams and customers."
          screen={featureScreens['task-projects']}
        />
        <FeaturePageSection
          id="task-views"
          title="List, board, or timeline."
          description="Switch between list, kanban board, and timeline views—or ask Macro Agents for a live status update across your team’s tasks."
          screen={featureScreens['task-views']}
        />
        <FeaturePhoneScreens screens={phoneScreens['tasks']} product="Tasks" />
        <TasksComparison />
        <FeaturePageFaq
          guide={{ href: '/tasks#guide', label: 'tasks' }}
          id="tasks-faq-title"
          title="Questions about Macro Tasks"
          items={tasksFaq}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}

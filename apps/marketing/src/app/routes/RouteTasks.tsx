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
import { PaperEmailTask } from '../../features/marketing/components/paper/PaperEmailTask';
import { PaperFeatureGraphic } from '../../features/marketing/components/paper/PaperFeatureGraphic';
import { GithubConversationDemo } from '../../features/marketing/components/reviews/GithubWorkflow';
import { TaskPaperGraphic } from '../../features/marketing/components/tasks/TaskPaperGraphic';
import {
  TaskAgentChannelDemo,
  TaskGithubDemo,
} from '../../features/marketing/components/tasks/TaskStories';
import { TaskViewsGraphic } from '../../features/marketing/components/tasks/TaskViewsGraphic';
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
          title="Tasks for people and agents."
          description="Create tasks from email and team chat. Assign people or agents, and keep task status in sync with linked pull requests."
        />
        <FeaturePageSection
          id="from-a-message"
          demo={{
            tone: 'tasks',
            glassFrame: true,
          }}
          title="Create tasks where the conversation happens."
          description="Click Create task on any message and the task is linked to that thread, so the conversation on the task and the conversation in the channel are deep linked together. Or mention @Macro and ask it to create tasks from what was just said; it can create many at once. Hit C then T to create one from anywhere."
        >
          <span id="ask-macro" />
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskAgentChannelDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="from-docs-and-email"
          title="Linked back to the email or doc it came from."
          description="Create a task from a customer email, or highlight to-do boxes in a document to create many at once. Tasks are linked back to their source bidirectionally: the task remembers where it came from, and the source knows the task exists. Paste a task into a channel and the pill shows its status, assignee, and priority."
        >
          <PaperFeatureGraphic label="Create a task from an email, with the original thread linked as its source.">
            <PaperEmailTask />
          </PaperFeatureGraphic>
        </FeaturePageSection>
        <FeaturePageSection
          id="task-agents"
          demo={{
            tone: 'tasks',
          }}
          title="Assign a task to an agent, just like a teammate."
          description="Put an agent on a task and it picks it up and gets to work, with the context linked to the task. Open its session to follow along. Through Macro’s MCP server, Claude Code, Codex, and Cursor can find, create, and update your tasks without leaving your editor."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubConversationDemo agent />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="github"
          demo={{
            tone: 'tasks',
            glassFrame: true,
          }}
          title="Linked to GitHub, both ways."
          description="As you create, review, and merge pull requests, the linked task moves through In Progress, In Review, and Completed. Click the GitHub pill to open the pull request from the task, or go back to the task from the pull request. Your team can see where the work stands without you having to update two systems."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskGithubDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="task-projects"
          title="Projects and tags."
          description="Group your work into projects. A project has its own page with a description, a discussion, and all of its tasks. Tags are for everything that cuts across projects: use a project when the work has an owner, a goal, and a finish line, and a tag when a task relates to many things at once."
        >
          <TaskPaperGraphic />
        </FeaturePageSection>
        <FeaturePageSection
          id="task-views"
          title="List, board, or timeline."
          description="Look at your tasks as a list, as a kanban board, or on a timeline, so you can see what’s in flight and what’s coming up next. Filter, sort, and group them, or ask your agent for an update on your team’s tasks."
        >
          <PaperFeatureGraphic
            interactive
            height={370}
            mobileHeight={390}
            label="The same tasks shown as a list, a board, or a timeline."
          >
            <TaskViewsGraphic />
          </PaperFeatureGraphic>
        </FeaturePageSection>
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

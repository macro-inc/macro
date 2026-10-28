import jacobPhoto from '../../assets/people/jacob.webp';
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
import { TaskContextDemo } from '../../features/marketing/components/tasks/TaskContextDemo';
import { TaskHeroDemo } from '../../features/marketing/components/tasks/TaskProjectView';
import {
  TaskAgentChannelDemo,
  TaskFromMessageDemo,
  TaskGithubDemo,
} from '../../features/marketing/components/tasks/TaskStories';
import { TasksComparison } from '../../features/marketing/components/tasks/TasksComparison';
import { DEMO_BOOKING_URL } from '../../features/marketing/core/navigation';
import '../../features/marketing/components/tasks/tasks-page.css';
import { setPageSeo } from '../utils/utilSeo';

const tasksFaq = [
  {
    q: 'How do I create and assign a task?',
    a: 'Create a task in Tasks or from a message. Give it a title, assign a person or available agent, and set its status and priority. Keep relevant files and conversations linked to the task.',
  },
  {
    q: 'Can I import existing tasks?',
    a: (
      <>
        You can import Linear issues or task CSVs. See{' '}
        <a href="/migrate">migration options</a>, or{' '}
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
        <a href="/pricing">plans and limits</a> before choosing a plan for your
        team.
      </>
    ),
  },
];

export function RouteTasks() {
  setPageSeo({
    title: 'Macro Tasks — Task management that keeps up with your team',
    description:
      'Turn requests in chat, email, and docs into assigned tasks. Keep the source attached, follow progress, and get work done with your team and agents.',
    path: '/tasks',
  });
  return (
    <ProductPage>
      <div class="tasks-page">
        <ProductHero
          cta="tasks_hero_get_started"
          product="Tasks"
          title={['Task tracking without', 'the busywork.']}
          description={[
            'Turn requests from chat, email, and docs',
            'into tasks your team can act on.',
          ]}
        />
        <TaskHeroDemo />
        <section
          class="tasks-founder-letter"
          aria-labelledby="tasks-founder-title"
        >
          <a
            class="tasks-founder-card"
            href="/posts/linear-alternative"
            aria-label="Read Jacob’s story: Macro vs. Linear"
          >
            <div class="tasks-founder-card-body">
              <h2 id="tasks-founder-title">Why we built Macro Tasks.</h2>
              <blockquote>
                “Tracking tasks felt like busywork to our team.”
              </blockquote>
              <div class="tasks-founder-person">
                <img
                  src={jacobPhoto}
                  alt="Jacob"
                  width="52"
                  height="52"
                  loading="lazy"
                />
                <div>
                  <strong>Jacob</strong>
                  <span>CEO and founder of Macro</span>
                </div>
              </div>
            </div>
            <div class="tasks-founder-card-article">
              <span>Macro vs. Linear</span>
              <span>
                Read the story <span aria-hidden="true">→</span>
              </span>
            </div>
          </a>
        </section>
        <FeaturePageSection
          id="from-a-message"
          title={['Turn requests in chat', 'into tasks.']}
          description="Turn a request in chat into a task without copying it into another tool. Give it an owner, set the priority, and keep the original conversation close by."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskFromMessageDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="ask-macro"
          title={['Keep your tasks', 'up to date with agents.']}
          description="Tell your agent what your team needs to get done in your team channels. The agent can create tasks, change who’s assigned, and check what tasks are still incomplete."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskAgentChannelDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="from-docs-and-email"
          title={['Attach files, people,', 'and emails to your task.']}
          description="Tag emails, documents, images, and team discussion directly to your task so your team has the context it needs to complete the task."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskContextDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="github"
          title={['Keep tasks in sync', 'with your code.']}
          description="Connect a task to its pull request and let the code update its status. The task moves into review when the PR opens and completes when the change merges."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <TaskGithubDemo />}
          />
        </FeaturePageSection>
        <TasksComparison />
        <FeaturePageFaq
          id="tasks-faq-title"
          title="Questions about Macro Tasks"
          items={tasksFaq}
        />
        <HomepageClosing />
      </div>
    </ProductPage>
  );
}

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
  TaskAgentChannelDemo,
  TaskFromChecklistDemo,
  TaskFromMessageDemo,
  TaskGithubDemo,
} from '../../features/marketing/components/tasks/TaskStories';
import { WorkspaceDesktopDemo } from '../../features/marketing/components/WorkspaceDesktopDemo';
import { setPageSeo } from '../utils/utilSeo';

const tasksFaq = [
  {
    q: 'How is Macro Tasks different from Linear?',
    a: (
      <>
        We used Linear before we built this, so the basics will feel familiar:
        keyboard shortcuts, statuses, priorities, and fast lists. The difference
        is that tasks live next to your email, chat, and docs. You make them
        from the conversation they came from, and they stay linked to it. Read
        our <a href="/posts/linear-alternative">Macro vs. Linear comparison</a>.
      </>
    ),
  },
  {
    q: 'Can I turn a message or email into a task?',
    a: 'Yes. Hover a message and click Task, or open an email and click Create task in the top right. The task links back to the original so whoever picks it up can read the whole thing.',
  },
  {
    q: 'How do I keep track of my tasks?',
    a: 'My Tasks shows what’s assigned to you, All Tasks shows everything your team can see, and Created by me shows what you’ve asked other people for. New assignments also land in Home next to your email and messages, so you don’t have to go looking.',
  },
  {
    q: 'Can agents work on tasks?',
    a: (
      <>
        Yes. Ask @Macro in a channel to create or update tasks, or hand a task
        to a coding agent like Claude Code or Cursor. When a pull request
        references the task, the status updates on its own. See{' '}
        <a href="/agents">agents in Macro</a>.
      </>
    ),
  },
  {
    q: 'How does the GitHub integration work?',
    a: (
      <>
        Install the GitHub app and put the task ID in a branch name, PR title,
        or PR description. Opening the PR moves the task to In Review, merging
        it marks it Completed, and closing it without merging moves it back to
        Not Started. More on <a href="/github">GitHub in Macro</a>.
      </>
    ),
  },
  {
    q: 'Is it only for engineering teams?',
    a: 'No. We run launches, customer follow-ups, and plenty of non-engineering work out of it. Anything with an owner and a due date works.',
  },
  {
    q: 'Is our workspace public because Macro is open source?',
    a: 'No. Our code is public. Your tasks, messages, and docs are not, and they follow your sharing settings.',
  },
  {
    q: 'Is there a free plan?',
    a: (
      <>
        Yes. Tasks come with email, chat, docs, and agents. See{' '}
        <a href="/pricing">pricing</a> for the current limits.
      </>
    ),
  },
];

export function RouteTasks() {
  setPageSeo({
    title: 'Macro Tasks — Task management that keeps up with your team',
    description:
      'Make tasks from messages, emails, and doc checklists in one click. Assign people or agents, and let GitHub pull requests update the status for you.',
    path: '/tasks',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Tasks"
        title={['Task tracking without', 'the busywork.']}
        description={[
          'Turn any message, email, or to-do into a task in one click.',
          'It stays linked to the conversation it came from.',
        ]}
        cta="tasks_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="tasks"
        label="Explore Macro Tasks"
        caption="A sample workspace. Open a task, change the owner, leave a comment."
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
          chat. Tickets are so easy to create from messages, and their status
          gets updated automatically so they'll actually get closed. After two
          years of dogfooding it's finally working for us. We hope you like it
          too!
        </p>
        <footer>— Jacob Beckerman, CEO and founder of Macro</footer>
      </section>
      <FeaturePageSection
        id="from-a-message"
        title="Any message can become a task."
        description={
          'Hover a message in any channel and click Task.\nThe task links back to the thread, so nobody has to ask what happened.'
        }
      >
        <div class="feature-page-visual">
          <TaskFromMessageDemo />
        </div>
        <ProductProse>
          <p>
            This is the one we use the most. Someone flags a bug in a channel,
            you hover the message and click Task. Macro fills in the title from
            the message, assigns whoever was @mentioned, and links the task to
            the thread. Whoever picks it up can read the replies instead of
            pinging you for the backstory. To start one from scratch, press C
            then T from anywhere in Macro.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="ask-macro"
        title="Or just ask @Macro."
        description={
          'Mention the Macro agent and say who’s doing what.\nOne message turns into as many assigned tasks as you need.'
        }
      >
        <div class="feature-page-visual">
          <TaskAgentChannelDemo />
        </div>
        <ProductProse>
          <p>
            When a conversation ends with three action items, nobody wants to
            file three tickets. Tag @Macro, tell it who owns what, and it
            creates the tasks and replies with links. Each link shows the task’s
            status, priority, and owner right in the channel, so you can see
            where things stand without opening a task tracker.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="from-docs-and-email"
        title="Turn to-dos into tasks."
        description={
          'Select a checklist in any doc and click Tasks. Every line becomes a real task.\nEmails get a Create task button too.'
        }
      >
        <div class="feature-page-visual">
          <TaskFromChecklistDemo />
        </div>
        <ProductProse>
          <p>
            Meeting notes are where action items go to die. In Macro, select the
            checkboxes in a doc and click Tasks. Each line becomes a task you
            can assign, and the doc keeps a live link to it, so you can see
            what’s done without leaving the notes. Email works the same way:
            open a thread, click Create task, and the task links back to the
            email.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="github"
        title="Closes itself when the PR merges."
        description={
          'Put the task ID in a branch or pull request.\nOpening the PR moves the task to In Review. Merging it marks it done.'
        }
      >
        <div class="feature-page-visual">
          <TaskGithubDemo />
        </div>
        <ProductProse>
          <p>
            Nobody on our team updates ticket status by hand anymore. When a
            pull request references a task, Macro links the two and shows the PR
            on the task. Opening it moves the task to In Review, merging it
            marks the task Completed, and closing it without merging puts it
            back in Not Started. It works the same when Claude Code or Cursor
            opens the PR, so the board stays accurate even when an agent did the
            work.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="tasks-faq-title"
        title="Questions about Macro Tasks"
        introduction={
          <p>
            If you’re coming from Linear, Jira, or Notion, most of what you know
            carries over. The difference is where tasks come from and how they
            stay up to date.
          </p>
        }
        items={tasksFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}

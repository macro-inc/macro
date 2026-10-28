import { setPageSeo } from '../../../app/utils/utilSeo';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import {
  GithubConversationDemo,
  GithubPrHero,
  GithubTaskDemo,
} from '../components/reviews/GithubWorkflow';
import { ReviewInboxDemo } from '../components/reviews/ReviewStories';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

const githubFaq = [
  {
    q: 'How do I connect GitHub?',
    a: 'Link your GitHub account in Macro’s Settings. Your GitHub permissions determine which repositories and pull requests you can access.',
  },
  {
    q: 'What can I do with pull requests in Macro?',
    a: 'Open a linked pull request from chat, inspect its changes, and read the discussion alongside your work. Your repositories, branches, CI, and repository settings stay on GitHub.',
  },
  {
    q: 'How do pull requests update tasks?',
    a: (
      <>
        Include the task ID in the branch name, PR title, or description.
        Opening the PR moves the task to In Review; merging completes it.
        Closing without merging returns it to Not Started. See{' '}
        <a href="/tasks">Macro Tasks</a>.
      </>
    ),
  },
  {
    q: 'Can a coding agent work from a team conversation?',
    a: (
      <>
        Yes. Give an available coding agent the conversation and relevant work
        as context. It can prepare a change and link the resulting pull request.
        See <a href="/agents">agent connections and availability</a>.
      </>
    ),
  },
  {
    q: 'Who can merge a pull request?',
    a: 'Users with the required GitHub access can merge eligible pull requests in Macro after confirming. GitHub’s branch protections still apply. Macro’s Merge button requires a ready PR with passing checks.',
  },
  {
    q: 'Can I submit a code review in Macro?',
    a: 'You can inspect changes and read the review discussion in Macro. Submit formal approvals and review comments on GitHub.',
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

export function RouteGithub() {
  setPageSeo({
    title: 'GitHub in Macro | Pull Requests, Code Changes, and Tasks',
    description:
      'Open GitHub pull requests from chat, inspect code changes, and keep linked tasks in sync. Work with coding agents and see review requests in your inbox.',
    path: '/github',
  });
  return (
    <ProductPage>
      <div class="github-page">
        <ProductHero
          product="for GitHub"
          title={['Write code, review PRs,', 'and ship in Macro.']}
          description={[
            'Read the discussion, inspect code changes,',
            'and keep linked tasks up to date.',
          ]}
          cta="github_hero_get_started"
        />
        <WorkspaceDesktopDemo
          heroFrame
          view="home"
          label="Explore GitHub in Macro"
          render={() => <GithubPrHero />}
        />
        <nav class="feature-page-jump-links" aria-label="On this page">
          <a href="#pr-links">
            <ContextGraphic />
            <span>Pull requests in chat</span>
          </a>
          <a href="#pr-tasks">
            <LinkedWorkGraphic />
            <span>Linked tasks</span>
          </a>
          <a href="#coding-agents">
            <EditingGraphic />
            <span>Coding agents</span>
          </a>
          <a href="#review-inbox">
            <ThreadGraphic />
            <span>Review requests</span>
          </a>
        </nav>
        <FeaturePageSection
          id="pr-links"
          title={['Review pull requests', 'without leaving chat.']}
          description="Share a GitHub pull request in chat and open it from the conversation. Read the discussion and inspect the code changes while the linked PR’s status stays up to date."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubConversationDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="pr-tasks"
          title={['Link pull requests', 'to tasks.']}
          description="Keep implementation and task tracking connected. Link a pull request to its task, then let opening, merging, or closing the PR update the task’s status."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubTaskDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="coding-agents"
          title={['Turn bug reports and', 'feature requests into PRs.']}
          description="Ask your coding agent to fix a bug as it comes up in your team conversations. It’ll see what was said and understand your request, then put up a PR."
        >
          <div class="feature-page-visual">
            <GithubConversationDemo agent />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="review-inbox"
          title={['See review requests', 'in one inbox.']}
          description="Find GitHub mentions, comments, and requested reviews alongside the rest of your work."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <ReviewInboxDemo />}
          />
        </FeaturePageSection>
        <FeaturePageFaq
          id="github-faq"
          title="Questions about Macro for GitHub"
          items={githubFaq}
        />
      </div>
      <HomepageClosing />
    </ProductPage>
  );
}

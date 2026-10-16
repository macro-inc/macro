import { setPageSeo } from '../../../app/utils/utilSeo';
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
    a: 'Link your GitHub account in Settings under Account.',
  },
  {
    q: 'What stays on GitHub?',
    a: 'Your repositories, branches, CI, and repository permissions stay on GitHub. Macro brings pull requests, code changes, and review discussions into your workspace. Submit approvals and review comments on GitHub.',
  },
  {
    q: 'How do pull requests link to tasks?',
    a: (
      <>
        Include the task ID in the branch name, PR title, or description.
        Opening the PR moves the linked task to In Review. Merging it marks the
        task Completed. Closing it without merging returns the task to Not
        Started. <a href="/tasks">More about tasks</a>.
      </>
    ),
  },
  {
    q: 'Can I merge a pull request in Macro?',
    a: 'Yes. Open the PR and choose Merge. You confirm before it merges, and GitHub applies your repository permissions and merge requirements.',
  },
  {
    q: 'Which coding agents can I use?',
    a: (
      <>
        Bring coding agents such as Cursor or Claude Code into your channels.{' '}
        <a href="/agents">See how to connect your agents</a>.
      </>
    ),
  },
  {
    q: 'Is there a free plan?',
    a: (
      <>
        Yes. See <a href="/pricing">pricing</a> for current limits.
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
          title={['Open pull requests', 'right in Macro.']}
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
        >
          <GithubPrHero />
        </WorkspaceDesktopDemo>
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
          title="Open the PR from the conversation."
          description="Share a pull request in chat. Its status stays current, and the changes are a click away."
        >
          <div class="feature-page-visual">
            <GithubConversationDemo />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="pr-tasks"
          title="Merge the PR and the task updates."
          description="Link a PR to a task. The task moves to In Review when the PR is created, and Completed when it merges."
        >
          <div class="feature-page-visual">
            <GithubTaskDemo />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="coding-agents"
          title="Ask an agent to fix a bug."
          description="Tag @Cursor in the conversation. Open its pull request to see what changed."
        >
          <div class="feature-page-visual">
            <GithubConversationDemo agent />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="review-inbox"
          title="Review requests in your inbox."
          description="See GitHub review requests, comments, and mentions alongside your messages, tasks, and email."
        >
          <div class="feature-page-visual">
            <ReviewInboxDemo />
          </div>
        </FeaturePageSection>
        <FeaturePageFaq
          id="github-faq"
          title="Frequently asked questions"
          items={githubFaq}
        />
      </div>
      <HomepageClosing />
    </ProductPage>
  );
}

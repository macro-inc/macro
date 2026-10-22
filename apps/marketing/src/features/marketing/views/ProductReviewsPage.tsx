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
          title={['Your pull requests,', 'with the rest of your work.']}
          description={[
            'Keep GitHub. Bring PRs into your team’s',
            'conversations, tasks, and inbox.',
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
          title={['Open the PR', 'beside the conversation.']}
          description="Paste a GitHub link into a channel or document and it becomes a live reference to the PR. See its status, open the diff, and read the discussion side by side. Your repositories and code stay on GitHub."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubConversationDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="pr-tasks"
          title={['Link pull requests', 'to tasks.']}
          description="The task explains why; the PR shows what changed. Link them in either direction. Opening the PR moves the task into review, merging marks it done, and closing without merging returns it to Not Started."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubTaskDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="coding-agents"
          title={['Turn bug reports and', 'feature requests into PRs.']}
          description="Mention your coding agent where the bug is being discussed. Give it the conversation and linked work as context, then review the pull request it prepares. You shouldn’t have to write the same bug report in three places."
        >
          <div class="feature-page-visual">
            <GithubConversationDemo agent />
          </div>
        </FeaturePageSection>
        <FeaturePageSection
          id="review-inbox"
          title={['One inbox for', 'the work waiting on you.']}
          description="PR comments, mentions, and review requests arrive alongside emails, messages, and task assignments. See what needs your attention without checking another notifications page."
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

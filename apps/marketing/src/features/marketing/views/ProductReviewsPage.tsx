import { lazy } from 'solid-js';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { DeferredDemo, DemoPlaceholder } from '../components/DeferredDemo';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  EditingGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import {
  GithubHomeHero,
  PrLinkDemo,
  ReviewInboxDemo,
} from '../components/reviews/ReviewStories';
import { TaskGithubDemo } from '../components/tasks/TaskStories';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

const loadPullRequest = () => import('../components/HomepagePullRequest');
const HomepagePullRequest = lazy(loadPullRequest);

const githubFaq = [
  {
    q: 'Is this a GitHub replacement?',
    a: 'No. Your code, reviews, and CI stay on GitHub. Macro brings the parts your team talks about into the workspace: notifications, PR status, and the link between a pull request and its task.',
  },
  {
    q: 'What shows up in my inbox?',
    a: 'Review requests, comments and reviews on your pull requests, mentions, and status changes on PRs you’re part of.',
  },
  {
    q: 'How do pull requests link to tasks?',
    a: (
      <>
        Put the task ID in the branch name, PR title, or PR description. Macro
        links them and moves the task as the PR opens, merges, or closes. More
        on <a href="/tasks">tasks in Macro</a>.
      </>
    ),
  },
  {
    q: 'Can I review code in Macro?',
    a: 'You can read the PR description and the review discussion in Macro. For the diff and approvals, Open on GitHub takes you there.',
  },
  {
    q: 'Which coding agents work with Macro?',
    a: (
      <>
        You can mention Cursor, Claude Code, and Codex in channels, and connect
        any MCP client to your workspace. See{' '}
        <a href="/agents">agents in Macro</a>.
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
    title: 'Macro Reviews — Review PRs in Your Inbox',
    description:
      'Review requests and PR comments land in your Macro inbox, GitHub links show live status, and tasks update themselves when pull requests open and merge.',
    path: '/github',
  });
  return (
    <ProductPage>
      <ProductHero
        product="for GitHub"
        title={['GitHub, wired into', 'your workspace.']}
        description={[
          'Review requests and PR comments land in your inbox.',
          'Link a PR to a task and it updates itself.',
        ]}
        cta="github_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="home"
        label="Explore GitHub in Macro"
        caption="A sample inbox. Open a review request to read the PR."
      >
        <GithubHomeHero />
      </WorkspaceDesktopDemo>
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#review-inbox">
          <ThreadGraphic />
          <span>Reviews in your inbox</span>
        </a>
        <a href="#pr-links">
          <ContextGraphic />
          <span>Live PR links</span>
        </a>
        <a href="#pr-tasks">
          <LinkedWorkGraphic />
          <span>Linked to tasks</span>
        </a>
        <a href="#coding-agents">
          <EditingGraphic />
          <span>Coding agents</span>
        </a>
      </nav>
      <FeaturePageSection
        id="review-inbox"
        title="Never miss a review."
        description={
          'Review requests, comments, and mentions on your pull requests land in Home.\nRight next to your messages, tasks, and email.'
        }
      >
        <div class="feature-page-visual">
          <ReviewInboxDemo />
        </div>
        <ProductProse>
          <p>
            GitHub notifications are easy to ignore, which is how a PR sits for
            two days waiting on a one-line review. Macro puts review requests,
            comments on your PRs, and mentions in the same inbox as everything
            else, so code review isn’t one more place to check. Press E when
            you’re done, same as everything else.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="pr-links"
        title="Paste a PR, see its status."
        description={
          'Pull request links turn into pills in docs and messages.\nHover one to see checks, comments, and the size of the change.'
        }
      >
        <div class="feature-page-visual">
          <PrLinkDemo />
        </div>
        <ProductProse>
          <p>
            Paste a pull request into a channel or a doc and Macro shows it with
            its status: open, merged, or closed. Hover it for the repo, the
            title, the line counts, and whether checks passed. No more “is this
            merged yet?” in the channel.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="pr-tasks"
        title="Tasks and PRs, linked both ways."
        description={
          'Put the task ID in a branch or PR title and the PR shows up on the task.\nOpening it moves the task to In Review. Merging it marks it done.'
        }
      >
        <div class="feature-page-visual">
          <TaskGithubDemo />
        </div>
        <ProductProse>
          <p>
            This is the part our engineers like most. The task shows its pull
            request, the pull request links back to the task, and nobody updates
            status by hand. Opening the PR moves the task to In Review, merging
            marks it Completed, and closing it without merging puts it back in
            Not Started.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="coding-agents"
        title="Coding agents in your channels."
        description={
          'Hand a bug to Cursor or Claude Code right from the conversation.\nThe agent works on the branch and comes back with a pull request.'
        }
      >
        {/* dummy-workspace opts the homepage demo's controls out of the
            site-wide button font, as on the homepage. */}
        <div class="feature-page-visual review-agent-demo dummy-workspace">
          <DeferredDemo
            preload={loadPullRequest}
            fallback={<DemoPlaceholder label="Agent session preview" />}
          >
            <HomepagePullRequest />
          </DeferredDemo>
        </div>
        <ProductProse>
          <p>
            Most bugs start as a message. In Macro, you can @mention Cursor or
            Claude Code in that same thread and hand it off. The agent works on
            the branch, reports back in the channel, and the PR shows up linked
            to the task, ready for review.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="github-faq"
        title="Questions about Macro and GitHub"
        introduction={
          <p>
            Your code and CI stay on GitHub. Macro handles the parts your team
            talks about.
          </p>
        }
        items={githubFaq}
      />
      <HomepageClosing />
    </ProductPage>
  );
}

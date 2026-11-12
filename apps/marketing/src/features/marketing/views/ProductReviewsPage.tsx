import { setPageSeo } from '../../../app/utils/utilSeo';
import { DemoInteractionBoundary } from '../components/DemoInteractionBoundary';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import {
  GithubConversationDemo,
  GithubTaskDemo,
} from '../components/reviews/GithubWorkflow';
import { ReviewInboxDemo } from '../components/reviews/ReviewStories';

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
        <a href="/pricing">plans and limits</a> for details.
      </>
    ),
  },
];

export function RouteGithub() {
  setPageSeo({
    title: 'GitHub in Macro | Pull Requests, Code Changes, and Tasks',
    description:
      'Bring GitHub pull requests into your unified inbox alongside messages, tasks, and important emails. Open linked tasks and PRs in split screen.',
    path: '/github',
  });
  return (
    <ProductPage>
      <div class="github-page">
        <ProductHero
          product="GitHub"
          title="Diffs and merge PRs from chat."
          description="Review diffs and merge pull requests from team chat. Comments and @mentions come back to your inbox."
          cta="github_hero_get_started"
          tutorial="github"
        />
        <FeaturePageSection
          id="pr-links"
          demo={{
            tone: 'github',
          }}
          title="Paste a GitHub link, get a live pull request."
          description="GitHub links render as pretty links in a document, in a channel in Macro Chat, or anywhere else you can write Markdown. Hover over one to see the pull request’s status."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubConversationDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="coding-agents"
          demo={{
            tone: 'github',
          }}
          title="@mention Cursor, merge from Macro Chat."
          description="Coding agents like Cursor live right in your channels. @mention one and ask it to fix something, and when the pull request is ready, merge it right from the channel. The task and the pull request link back to each other."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubConversationDemo agent />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="pr-tasks"
          demo={{
            tone: 'github',
          }}
          title="Macro Tasks move as the pull request moves."
          description="As you create, review, and merge a pull request, the linked task moves through In Progress, In Review, and Completed. Click the GitHub pill to go right to the pull request from the task, or vice versa. It opens in a split screen, so you don’t have to leave Macro."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <GithubTaskDemo />}
          />
        </FeaturePageSection>
        <FeaturePageSection
          id="review-inbox"
          demo={{
            tone: 'github',
          }}
          title="Pull requests in your inbox."
          description="GitHub’s own notifications are not very good. When you get a comment on a pull request you authored, or you’re mentioned in one, it appears in your unified inbox alongside your messages, tasks, and important emails, so you never miss a pull request."
        >
          <DemoInteractionBoundary
            class="feature-page-visual"
            render={() => <ReviewInboxDemo />}
          />
        </FeaturePageSection>
        <FeaturePageFaq
          guide={{ href: '/github#guide', label: 'GitHub' }}
          id="github-faq"
          title="Questions about Macro for GitHub"
          items={githubFaq}
        />
      </div>
      <HomepageClosing />
    </ProductPage>
  );
}

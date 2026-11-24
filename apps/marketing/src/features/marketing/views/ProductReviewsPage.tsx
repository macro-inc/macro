import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import { ProductHero, ProductPage } from '../components/product/ProductPage';
import './product-reviews-page.css';
import { FeaturePhoneScreens } from '../components/FeatureScreenshot';
import { featureScreens, phoneScreens } from '../core/feature-screens';

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
          title="From bug report to merged PR."
          description="Review diffs, read review comments, and merge PRs right inside Macro so engineering work stays beside the thread that started it."
          cta="github_hero_get_started"
          tutorial="github"
        />
        <FeaturePageSection
          id="pr-links"
          title={'Link the task, the chat,\nand the pull request.'}
          description="Paste a GitHub URL in Macro Chat or Macro Docs for live PR status on hover. The linked Macro Tasks item updates itself when the PR opens or merges."
          screen={featureScreens['pr-links']}
        />
        <FeaturePageSection
          id="coding-agents"
          title="@mention Cursor, merge from Macro Chat."
          description="Tag Cursor or another coding agent right inside Macro Chat to investigate and open a branch. Review the diff and merge the PR without leaving the channel."
          screen={featureScreens['coding-agents']}
        />
        <FeaturePageSection
          id="pr-tasks"
          title="Macro Tasks move as the pull request moves."
          description="The linked task moves through In Progress, In Review, and Completed as you create, review, and merge a pull request. Click the GitHub pill to jump between the task and PR—it opens in split screen so you never leave Macro."
          screen={featureScreens['pr-tasks']}
        />
        <FeaturePageSection
          id="review-inbox"
          title="Pull requests in your inbox."
          description="GitHub’s notification inbox is easy to miss. PR comments and @mentions land straight in Macro Home beside your team chat, Macro Tasks, and priority Macro Mail."
          screen={featureScreens['review-inbox']}
        />
        <FeaturePhoneScreens
          screens={phoneScreens['github']}
          product="GitHub"
        />
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

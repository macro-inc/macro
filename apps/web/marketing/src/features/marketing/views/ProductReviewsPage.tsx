import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeaturePageFaq, FeaturePageSection } from '../components/FeaturePage';
import { HomepageClosing } from '../components/HomepageClosing';
import {
  ContextGraphic,
  DiffGraphic,
  LinkedWorkGraphic,
  ThreadGraphic,
} from '../components/product/ProductGraphics';
import {
  ProductHero,
  ProductPage,
  ProductProse,
} from '../components/product/ProductPage';
import {
  ReviewAgentDemo,
  ReviewDiffDemo,
  ReviewDiscussionDemo,
  ReviewLinkedTaskDemo,
  ReviewQueueDemo,
} from '../components/reviews/ReviewStories';
import { WorkspaceDesktopDemo } from '../components/WorkspaceDesktopDemo';

export function RouteGithub() {
  setPageSeo({
    title: 'Macro Reviews — Review PRs in Your Inbox',
    description:
      'Find pull requests, read GitHub discussion, inspect agent changes, and connect code review to the task behind the work.',
    path: '/github',
  });
  return (
    <ProductPage>
      <ProductHero
        product="Reviews"
        title={['GitHub pull requests', 'in your inbox.']}
        description={[
          'Review comments, mentions, and linked tasks.',
          'Follow the code from request to merge.',
        ]}
        cta="github_hero_get_started"
      />
      <WorkspaceDesktopDemo
        view="tasks"
        label="Explore Macro Reviews"
        caption="Find a pull request and open its details. This interactive example uses fictional reviews."
      >
        <ReviewQueueDemo />
      </WorkspaceDesktopDemo>
      <nav class="feature-page-jump-links" aria-label="On this page">
        <a href="#review-queue">
          <LinkedWorkGraphic />
          <span>Find your review</span>
        </a>
        <a href="#review-diff">
          <DiffGraphic />
          <span>Inspect the change</span>
        </a>
        <a href="#review-discussion">
          <ThreadGraphic />
          <span>Read the discussion</span>
        </a>
        <a href="#review-agent">
          <ContextGraphic />
          <span>Ask a precise question</span>
        </a>
      </nav>
      <FeaturePageSection
        id="review-queue"
        title="Your GitHub review queue, in Macro."
        description={
          'Find pull requests you authored, commented on, or were mentioned in.\nOpen their descriptions, repositories, and review discussion.'
        }
      >
        <div class="feature-page-visual">
          <ReviewQueueDemo animate />
        </div>
        <ProductProse>
          <p>
            GitHub events bring pull requests into Macro. Involving me collects
            the reviews you participate in, alongside the rest of your work.
            Each pull request retains its author, repository, description, and
            status. Search by title or open the GitHub link for repository
            actions.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="review-diff"
        title="Read the agent’s diff."
        description={
          'Open Changes in an agent session to inspect its file edits.\nAdded and removed lines show exactly what it proposes.'
        }
      >
        <div class="feature-page-visual">
          <ReviewDiffDemo />
        </div>
        <ProductProse>
          <p>
            Coding agent sessions expose proposed file changes in a diff. You
            can inspect the implementation alongside the prompt and the agent’s
            explanation. A linked pull request opens the GitHub review record.
            Its discussion is available in Macro, with a link to GitHub for the
            repository diff.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="review-discussion"
        title="GitHub comments, with file and line references."
        description={
          'Read review comments and replies inside the pull request.\nFilter bot messages when you want to focus on the human discussion.'
        }
      >
        <div class="feature-page-visual">
          <ReviewDiscussionDemo />
        </div>
        <ProductProse>
          <p>
            Macro imports GitHub discussion, including review threads and author
            replies. File and line references show which part of the code a
            comment concerns. Comments and mentions appear with the pull request
            in your workspace. You can follow the review while reading the task
            that prompted the change.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="review-agent"
        title="Ask the coding agent about its change."
        description={
          'Question a retry condition, a dependency, or a behavior in the diff.\nThe agent can explain the implementation using the code in its session.'
        }
      >
        <div class="feature-page-visual">
          <ReviewAgentDemo />
        </div>
        <ProductProse>
          <p>
            The coding session contains the request, proposed changes, and agent
            conversation. Ask about a specific file or branch of the
            implementation and inspect its answer against the diff. Use your
            review to decide the next step: request a revision, run a check, or
            open the pull request on GitHub.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageSection
        id="review-task"
        title="Task status follows the pull request."
        description={
          'Link a task to the code change that implements it.\nOpening the pull request moves it into review; merging completes it.'
        }
      >
        <div class="feature-page-visual">
          <ReviewLinkedTaskDemo />
        </div>
        <ProductProse>
          <p>
            GitHub events update linked tasks. A new pull request sets In
            Review, and a merge sets Completed. The task keeps its brief, owner,
            and discussion. Open the pull request from the task, or follow the
            reference back to the request behind the code.
          </p>
        </ProductProse>
      </FeaturePageSection>
      <FeaturePageFaq
        id="reviews-faq"
        eyebrow="GitHub events and linked work"
        title="How Reviews works."
        introduction={
          <p>
            Pull requests and review discussion in Macro, with task updates
            driven by GitHub events.
          </p>
        }
        items={[
          {
            q: 'What does Reviews show?',
            a: 'Pull requests with their description, author, repository, status, changes, GitHub discussion, and available check information.',
          },
          {
            q: 'Where can I inspect the diff?',
            a: 'Agent sessions show proposed file changes in their Changes surface. The pull-request view links to GitHub for the repository diff and repository actions.',
          },
          {
            q: 'Can I read GitHub comments in Macro?',
            a: 'Yes. GitHub discussion is imported into the pull-request view, including review comments and replies.',
          },
          {
            q: 'How do pull requests relate to tasks?',
            a: 'Linked pull-request events can move a task into review and complete it when the pull request is merged.',
          },
          {
            q: 'Do these examples use a real repository?',
            a: 'No. They use fictional local data and do not run checks, post comments, or merge changes.',
          },
        ]}
      />
      <HomepageClosing />
    </ProductPage>
  );
}

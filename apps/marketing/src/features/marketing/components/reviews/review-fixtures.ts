import type { HomepagePersonId } from '../../core/homepage-demo-people';

export type PrStatus = 'open' | 'merged' | 'closed';

/** One GitHub comment as block-pr's timeline receives it. */
export type DemoGithubComment = {
  id: string;
  person: HomepagePersonId;
  /** GitHub login; `[bot]` logins count toward "Hide bots". */
  login: string;
  time: string;
  body: string;
  /** `review_comment` anchor (`path:line`) or a source label like "review". */
  badge?: string;
  anchor?: boolean;
  replies?: DemoGithubComment[];
};

export type DemoPullRequest = {
  id: string;
  title: string;
  repo: string;
  number: number;
  status: PrStatus;
  author: HomepagePersonId;
  login: string;
  additions: number;
  deletions: number;
  checksPassed: number;
  description: string;
  comments: DemoGithubComment[];
};

/** One original PR shared by the GitHub page’s independent scenes. */
export const signInPr: DemoPullRequest = {
  id: 'pr-491',
  title: 'Fix mobile sign-in',
  repo: 'macro-inc/website',
  number: 491,
  status: 'open',
  author: 'teo',
  login: 'teo',
  additions: 14,
  deletions: 3,
  checksPassed: 6,
  description:
    '## What changed\n\nThe mobile sign-in button now submits the form, just like the desktop button. Both layouts use the same submit handler.\n\nFixes WEB-42.\n\n## Tested\n\n- Sign in at mobile and desktop widths\n- Submit with the Enter key\n- Show an error for incorrect passwords',
  comments: [
    {
      id: 'keyboard',
      person: 'julia',
      login: 'julia',
      time: '10:21 AM',
      badge: 'src/auth/SignIn.tsx:18',
      anchor: true,
      body: 'does enter still work on desktop?',
      replies: [
        {
          id: 'keyboard-reply',
          person: 'teo',
          login: 'teo',
          time: '10:24 AM',
          body: 'yep, both go through the form now. added a test for enter too',
        },
      ],
    },
  ],
};

export const onboardingPr: DemoPullRequest = {
  id: 'pr-479',
  title: 'Shorten the onboarding checklist',
  repo: 'macro-inc/website',
  number: 479,
  status: 'merged',
  author: 'jacob',
  login: 'jacob',
  additions: 12,
  deletions: 31,
  checksPassed: 9,
  description:
    '## What changed\n\nThe onboarding checklist goes from seven steps to four. Calendar and email setup move to Settings, where people looked for them anyway.\n\nFixes LAUNCH-38.',
  comments: [
    {
      id: 'approve',
      person: 'valentina',
      login: 'valentina',
      time: '9:12 AM',
      badge: 'review',
      body: 'Checked it on mobile too. Ship it.',
    },
  ],
};

/** GitHub comment count as the hover card reports it (replies included). */
export function prCommentCount(pr: DemoPullRequest) {
  return pr.comments.reduce(
    (count, comment) => count + 1 + (comment.replies?.length ?? 0),
    0
  );
}

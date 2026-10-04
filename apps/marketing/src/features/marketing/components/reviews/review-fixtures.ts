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

/** The same pull request the Tasks page links to its task. */
export const invitePr: DemoPullRequest = {
  id: 'pr-491',
  title: 'Keep the invited team through sign-up',
  repo: 'launch-team/web',
  number: 491,
  status: 'open',
  author: 'teo',
  login: 'teo',
  additions: 38,
  deletions: 6,
  checksPassed: 12,
  description:
    '## What changed\n\nNew teammates who accept an invite now stay in the invited team through sign-up. Existing accounts switch to that team after they sign in.\n\nFixes LAUNCH-42.\n\n## Testing\n\n- New account from an invite link\n- Existing account from an invite link\n- Expired invite still shows the error page',
  comments: [
    {
      id: 'expired',
      person: 'julia',
      login: 'juliawestphal',
      time: '10:21 AM',
      badge: 'src/invite/accept-invite.ts:42',
      anchor: true,
      body: 'If the invite has expired this still falls through to the personal workspace. Can we keep the error page for that case?',
      replies: [
        {
          id: 'expired-reply',
          person: 'teo',
          login: 'teo',
          time: '10:34 AM',
          body: 'Good catch. Expired invites go to the error page again, and there’s a test for it now.',
        },
      ],
    },
    {
      id: 'bugbot',
      person: 'cursor',
      login: 'cursor[bot]',
      time: '10:36 AM',
      body: 'Bugbot reviewed this pull request and found no new issues.',
    },
  ],
};

export const onboardingPr: DemoPullRequest = {
  id: 'pr-479',
  title: 'Shorten the onboarding checklist',
  repo: 'launch-team/web',
  number: 479,
  status: 'merged',
  author: 'jacob',
  login: 'jbeckerman',
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

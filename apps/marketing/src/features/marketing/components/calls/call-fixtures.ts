import type { WorkspaceComment } from '../../core/dummy-workspace';

/** People who appear in the sample calls. */
export type CallPerson = 'jacob' | 'teo' | 'julia' | 'gabriel' | 'valentina';

/** Participant pills show `idToEmail(userId)` in the app. */
export const callEmail = (person: CallPerson) => `${person}@macro.com`;

export type CallSegment = {
  id: string;
  person: CallPerson;
  /** Seconds from the start of the recording. */
  at: number;
  text: string;
};

/** A tile in the recording's composite frame; `video: false` shows the avatar. */
export type CallPosterTile = { person: CallPerson; video: boolean };

export type SampleCall = {
  title: string;
  /** `MMM d, yyyy · h:mm a` of the call's end, as CallRecordingBody formats it. */
  ended: string;
  /** Duration in seconds. */
  duration: number;
  people: CallPerson[];
  summary: string;
  segments: CallSegment[];
  poster: CallPosterTile[];
  speaking?: CallPerson;
  chat?: WorkspaceComment[];
};

export const launchCheckIn: SampleCall = {
  title: 'Launch check-in',
  ended: 'Sep 24, 2026 · 9:48 AM',
  duration: 18 * 60 + 22,
  people: ['jacob', 'teo', 'julia'],
  summary: [
    '- **Launch stays on Thursday.** The invite handoff is the only open risk.',
    '- **Teo** checks both invite paths on staging by Wednesday night: new accounts, and existing accounts switching teams.',
    '- **Julia** holds the announcement until Teo confirms, then sends it Thursday morning.',
    '- **Jacob** owns the launch checklist and a five-minute check on Wednesday at 5.',
  ].join('\n'),
  segments: [
    {
      id: 'thursday',
      person: 'jacob',
      at: 4,
      text: 'Quick one. Are we still good for Thursday?',
    },
    {
      id: 'invite-risk',
      person: 'teo',
      at: 41,
      text: 'Almost. The invite fix is merged, but new accounts were still landing in their personal workspace yesterday.',
    },
    {
      id: 'hold',
      person: 'julia',
      at: 72,
      text: 'Then I’ll hold the announcement. It goes out Thursday morning once Teo says it works.',
    },
    {
      id: 'verify',
      person: 'teo',
      at: 98,
      text: 'I’ll check both invite paths on staging by Wednesday night and post in #launch when it’s done.',
    },
    {
      id: 'owners',
      person: 'jacob',
      at: 125,
      text: 'Good. Teo has the invite check, Julia has the announcement, and I’ll do the checklist.',
    },
    {
      id: 'help-doc',
      person: 'julia',
      at: 151,
      text: 'Can we add the new invite steps to the help doc too?',
    },
    {
      id: 'with-fix',
      person: 'teo',
      at: 164,
      text: 'Yes, I’ll update it with the fix.',
    },
    {
      id: 'wednesday',
      person: 'jacob',
      at: 190,
      text: 'Then we’re set. Five-minute check on Wednesday at 5.',
    },
    {
      id: 'final-draft',
      person: 'julia',
      at: 198,
      text: 'Works for me. I’ll bring the final draft.',
    },
    {
      id: 'staging-results',
      person: 'teo',
      at: 204,
      text: 'I’ll have the staging results by then.',
    },
  ],
  poster: [
    { person: 'jacob', video: true },
    { person: 'julia', video: true },
    { person: 'teo', video: false },
  ],
  speaking: 'julia',
  chat: [
    {
      id: 'draft-link',
      person: 'julia',
      body: 'The announcement draft is in the launch plan.',
      time: '9:37 AM',
      documentId: 'plan',
    },
  ],
};

export const inviteTriage: SampleCall = {
  title: 'Invite bug triage',
  ended: 'Sep 24, 2026 · 11:02 AM',
  duration: 12 * 60 + 4,
  people: ['teo', 'gabriel'],
  summary: [
    '- **Gabriel reproduced it on staging.** New accounts land in their personal workspace after accepting an invite. Existing accounts are fine.',
    '- **Cause:** sign-up drops the invited team when it creates the personal workspace.',
    '- **Teo** keeps the invited team selected through sign-up and ships the fix today. **Gabriel** re-tests both paths before Thursday.',
  ].join('\n'),
  segments: [
    {
      id: 'repro',
      person: 'gabriel',
      at: 3,
      text: 'I can reproduce it every time. New account, accept the invite, and you land in your personal workspace.',
    },
    {
      id: 'existing',
      person: 'teo',
      at: 29,
      text: 'Existing accounts too, or just new ones?',
    },
    {
      id: 'new-only',
      person: 'gabriel',
      at: 35,
      text: 'Just new ones. Existing accounts switch teams fine.',
    },
    {
      id: 'cause',
      person: 'teo',
      at: 62,
      text: 'Then sign-up is dropping the invited team. I’ll keep it selected through sign-up and ship it today.',
    },
  ],
  poster: [
    { person: 'gabriel', video: true },
    { person: 'teo', video: false },
  ],
  speaking: 'gabriel',
};

export function formatVideoTimestamp(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `formatCallDuration` from block-call/utils. */
export function formatCallDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export const announcementReview: SampleCall = {
  title: 'Announcement review',
  ended: 'Sep 23, 2026 · 4:12 PM',
  duration: 9 * 60 + 41,
  people: ['julia', 'jacob'],
  summary: [
    '- **Julia** walked through the draft. The pricing paragraph comes out; the product demo video stays.',
    '- **Jacob** reads the final version Wednesday night.',
  ].join('\n'),
  segments: [
    {
      id: 'draft',
      person: 'julia',
      at: 6,
      text: 'The draft is in the launch plan. I think the pricing paragraph is too much for day one.',
    },
    {
      id: 'cut',
      person: 'jacob',
      at: 31,
      text: 'Agreed, cut it. Keep the demo video at the top.',
    },
  ],
  poster: [
    { person: 'julia', video: true },
    { person: 'jacob', video: true },
  ],
  speaking: 'julia',
};

export const pricingFeedback: SampleCall = {
  title: 'Pricing page feedback',
  ended: 'Sep 21, 2026 · 2:30 PM',
  duration: 24 * 60 + 10,
  people: ['jacob', 'gabriel', 'julia'],
  summary: [
    '- Keep the free plan above the fold.',
    '- **Gabriel** tests the new comparison table with five customers this week.',
  ].join('\n'),
  segments: [
    {
      id: 'free',
      person: 'jacob',
      at: 12,
      text: 'People keep asking if there’s a free plan. It should be the first thing they see.',
    },
    {
      id: 'table',
      person: 'gabriel',
      at: 48,
      text: 'I’ll put the comparison table in front of five customers this week.',
    },
  ],
  poster: [
    { person: 'jacob', video: true },
    { person: 'gabriel', video: true },
    { person: 'julia', video: true },
  ],
  speaking: 'gabriel',
};

export const weeklyPlanning: SampleCall = {
  title: 'Weekly planning',
  ended: 'Sep 21, 2026 · 10:34 AM',
  duration: 31 * 60 + 5,
  people: ['jacob', 'julia', 'teo', 'gabriel'],
  summary: [
    '- Launch week. Invite handoff, announcement, and help docs are the only open items.',
    '- **Teo** pauses the onboarding work until the invite fix ships.',
  ].join('\n'),
  segments: [
    {
      id: 'week',
      person: 'jacob',
      at: 9,
      text: 'This week is the launch. Anything that isn’t the launch can wait.',
    },
    {
      id: 'pause',
      person: 'teo',
      at: 40,
      text: 'Then I’ll pause onboarding until the invite fix is out.',
    },
  ],
  poster: [
    { person: 'jacob', video: true },
    { person: 'julia', video: true },
    { person: 'gabriel', video: true },
  ],
  speaking: 'jacob',
};

export const onboardingWalkthrough: SampleCall = {
  title: 'Onboarding walkthrough',
  ended: 'Sep 18, 2026 · 3:15 PM',
  duration: 16 * 60 + 48,
  people: ['teo', 'gabriel'],
  summary: [
    '- **Teo** showed the new invite screen.',
    '- **Gabriel** wants one fewer step before someone opens their first doc.',
  ].join('\n'),
  segments: [
    {
      id: 'screen',
      person: 'teo',
      at: 5,
      text: 'This is the new invite screen. Pick a team, then you’re in.',
    },
    {
      id: 'steps',
      person: 'gabriel',
      at: 37,
      text: 'Can we drop the workspace name step? Most people skip it.',
    },
  ],
  poster: [
    { person: 'gabriel', video: true },
    { person: 'teo', video: false },
  ],
  speaking: 'teo',
};

export const helpCenterReview: SampleCall = {
  title: 'Help center review',
  ended: 'Sep 17, 2026 · 1:20 PM',
  duration: 14 * 60 + 2,
  people: ['valentina', 'julia'],
  summary: [
    '- **Valentina** drafted three articles for the new invite flow.',
    '- **Julia** links them from the announcement.',
  ].join('\n'),
  segments: [
    {
      id: 'articles',
      person: 'valentina',
      at: 8,
      text: 'There are three articles: inviting your team, switching teams, and fixing a wrong workspace.',
    },
    {
      id: 'link',
      person: 'julia',
      at: 33,
      text: 'I’ll link all three from the announcement.',
    },
  ],
  poster: [
    { person: 'julia', video: true },
    { person: 'valentina', video: false },
  ],
  speaking: 'valentina',
};

export const inviteDesignReview: SampleCall = {
  title: 'Invite screen design review',
  ended: 'Sep 16, 2026 · 11:45 AM',
  duration: 22 * 60 + 40,
  people: ['jacob', 'teo', 'julia'],
  summary: [
    '- Keep the team picker on the first screen.',
    '- **Teo** removes the workspace name step.',
  ].join('\n'),
  segments: [
    {
      id: 'picker',
      person: 'jacob',
      at: 14,
      text: 'The team picker should be the first thing you see after accepting.',
    },
    {
      id: 'remove',
      person: 'teo',
      at: 41,
      text: 'Agreed. I’ll take out the workspace name step.',
    },
  ],
  poster: [
    { person: 'jacob', video: true },
    { person: 'julia', video: true },
    { person: 'teo', video: false },
  ],
  speaking: 'jacob',
};

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

export const rolloutCheckIn: SampleCall = {
  title: 'Training check-in',
  ended: 'Oct 7, 2026 · 9:48 AM',
  duration: 18 * 60 + 22,
  people: ['jacob', 'teo', 'julia'],
  summary: [
    '- **Julia** leads Thursday’s training at 10.',
    '- **Teo** sends his notes today.',
    '- **Julia** updates the slides and sends the invite.',
  ].join('\n'),
  segments: [
    {
      id: 'monday',
      person: 'jacob',
      at: 4,
      text: 'Who’s leading training on Thursday?',
    },
    {
      id: 'conflict',
      person: 'teo',
      at: 41,
      text: 'I can’t make it. Julia, can you take it?',
    },
    {
      id: 'owner',
      person: 'julia',
      at: 72,
      text: 'Yep, I’ll run it at 10. Can you send me your notes?',
    },
    {
      id: 'verify',
      person: 'teo',
      at: 98,
      text: 'Sure, I’ll send them over today.',
    },
    {
      id: 'invitations',
      person: 'julia',
      at: 125,
      text: 'Thanks. I’ll update the slides and send the invite.',
    },
    {
      id: 'task',
      person: 'jacob',
      at: 151,
      text: 'Great, I’ll put you down as the owner.',
    },
  ],
  poster: [
    { person: 'jacob', video: false },
    { person: 'julia', video: false },
    { person: 'teo', video: false },
  ],
  chat: [
    {
      id: 'agenda',
      person: 'julia',
      body: 'Send me the notes when you get a chance.',
      time: '9:37 AM',
    },
  ],
};

export const trainingReview: SampleCall = {
  title: 'Training prep',
  ended: 'Oct 7, 2026 · 11:02 AM',
  duration: 12 * 60 + 4,
  people: ['teo', 'julia'],
  summary: [
    '- Keep the session to 30 minutes.',
    '- **Julia** finishes the slides today.',
  ].join('\n'),
  segments: [
    {
      id: 'agenda',
      person: 'julia',
      at: 3,
      text: 'We’ve got half an hour. Is that enough?',
    },
    {
      id: 'examples',
      person: 'teo',
      at: 29,
      text: 'Yep. A quick intro, then an example.',
    },
    {
      id: 'checklists',
      person: 'julia',
      at: 62,
      text: 'Sounds good. I’ll finish the slides today.',
    },
  ],
  poster: [
    { person: 'julia', video: false },
    { person: 'teo', video: false },
  ],
};

export const rolloutPlanning: SampleCall = {
  title: 'Weekly planning',
  ended: 'Oct 6, 2026 · 4:12 PM',
  duration: 14 * 60 + 10,
  people: ['jacob', 'teo', 'julia'],
  summary:
    '- Training is Thursday at 10.\n- Teo prepares the session. Julia sends the invite.',
  segments: [
    {
      id: 'date',
      person: 'jacob',
      at: 6,
      text: 'Can we do training on Thursday?',
    },
    {
      id: 'training',
      person: 'teo',
      at: 31,
      text: 'Sure. I’ll put something together for 10.',
    },
    { id: 'attendees', person: 'julia', at: 52, text: 'I’ll send an invite.' },
  ],
  poster: [
    { person: 'jacob', video: false },
    { person: 'julia', video: false },
    { person: 'teo', video: false },
  ],
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

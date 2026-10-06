import type { AgentToolCall, SearchHit } from './AgentTranscript';

const calls = (items: AgentToolCall[]) => items;

/** Fictional fixtures for the Agents page. Model names match the app's picker. */
export const AGENT_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'gpt-5.6', label: 'GPT-5.6' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];

export const AGENT_PLACEHOLDER = 'Message the agent, @mention anything';

const northwindHits: SearchHit[] = [
  {
    kind: 'email',
    title: 'Re: Northwind pilot pricing',
    sender: 'Valentina',
    snippet: 'I’ll send pricing for 40 seats myself by Friday.',
    time: 'Tue',
  },
  {
    kind: 'call',
    title: 'Northwind demo',
    sender: 'Marcus Lee',
    snippet: 'Before this goes to the ops team we need SSO.',
    time: 'Tue',
  },
  {
    kind: 'channel',
    title: 'sales',
    sender: 'Valentina',
    snippet: 'Demo went well. Marcus wants SSO before the ops rollout.',
    time: 'Tue',
  },
  {
    kind: 'document',
    title: 'Northwind pilot plan',
    snippet: 'Two-week pilot with the ops team, 40 seats.',
    time: 'Mon',
  },
  {
    kind: 'email',
    title: 'Northwind pilot kickoff',
    sender: 'Marcus Lee',
    snippet: 'Looking forward to getting the team set up.',
    time: 'Sep 22',
  },
  {
    kind: 'channel',
    title: 'sales',
    sender: 'Jacob Beckerman',
    snippet: 'who’s following up with Northwind?',
    time: 'Wed',
  },
];

const NORTHWIND_THOUGHT =
  'Marcus is waiting on pricing and SSO. I’ll check who promised what, and who was on the demo call.';

/** One Northwind conversation, shared by the memory and model demos. */
export const northwind = {
  title: 'Northwind follow-up',
  earlier: {
    prompt: 'Where are we with Northwind?',
    calls: calls([
      {
        kind: 'search',
        query: 'Northwind pilot',
        hits: northwindHits.slice(0, 4),
      },
      { kind: 'read-thread' },
    ]),
    answer:
      'They’re two weeks into a pilot with their ops team. Marcus is waiting on two things from us: pricing for 40 seats and an answer on SSO.',
  },
  prompt: 'Who should own the Northwind follow-up?',
  thought: NORTHWIND_THOUGHT,
  calls: calls([
    { kind: 'thought', text: NORTHWIND_THOUGHT },
    { kind: 'search', query: 'Northwind', hits: northwindHits },
    { kind: 'read-channel', channel: 'sales', count: 14 },
    { kind: 'read-call' },
  ]),
  /** Streamed in order; chunk edges never split a mention or emphasis. */
  answer: [
    '@[Valentina](agent:valentina). ',
    'She ran the demo and told Marcus she’d send the pricing herself in ',
    '@[Re: Northwind pilot pricing](agent:pricing). ',
    'She also took his SSO question during @[Northwind demo](agent:demo), ',
    'so she has the context on both.',
    '\n\nWant me to create the task and assign it to her?',
  ],
  /** The same question, answered again after switching models. */
  switchedCalls: calls([
    { kind: 'search', query: 'Northwind', hits: northwindHits },
    { kind: 'read-call' },
  ]),
  switchedAnswer:
    '@[Valentina](agent:valentina). She told Marcus she’d send the 40-seat pricing herself in @[Re: Northwind pilot pricing](agent:pricing), and she answered his SSO question during @[Northwind demo](agent:demo).',
};

/** The Meadow rollout, cited from items that exist in the sample workspace. */
export const meadow = {
  title: 'Meadow before Thursday',
  prompt: 'What does Meadow still need from us before Thursday?',
  calls: calls([
    {
      kind: 'search',
      query: 'Meadow',
      hits: [
        {
          kind: 'email',
          title: 'Next steps for our team',
          sender: 'Dana Whitfield',
          snippet: 'Thursday at 9 works. Could you share the rollout plan?',
          time: '9:41 AM',
        },
        {
          kind: 'document',
          title: 'Demo call notes',
          snippet: 'Dana’s team wants email, tasks, and documents together.',
          time: 'Sep 28',
        },
        {
          kind: 'channel',
          title: 'customers',
          sender: 'Jacob Beckerman',
          snippet: 'Thursday agenda: connect inbox, invite team, share one…',
          time: '9:18 AM',
        },
        {
          kind: 'call',
          title: 'Meadow onboarding',
          sender: 'Dana Whitfield',
          snippet: 'Can we bring over the docs we already have?',
          time: 'Sep 26',
        },
      ],
    },
    { kind: 'read-thread' },
    { kind: 'read-channel', channel: 'customers', count: 18 },
    { kind: 'read-call' },
  ]),
  answer:
    'Three things before Thursday:\n\n- **The rollout plan.** Dana asked for it in @[Next steps for our team](agent:email). Julia’s draft reply links @[Team rollout plan](agent:rollout).\n- **Answers to their questions** on seats, shared email access, and importing docs. They’re in @[Demo call notes](agent:notes).\n- **The agenda.** Jacob posted it in @[customers](agent:customers): connect the inbox, invite the team, share one email, make one task.',
  followUp:
    'Dana is waiting on the @[Team rollout plan](agent:rollout), and Julia is sending the setup steps before the call. The open questions are in @[Demo call notes](agent:notes).',
};

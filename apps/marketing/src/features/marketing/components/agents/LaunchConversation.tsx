import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import {
  AgentAnswer,
  type AgentMention,
  AgentPrompt,
  type AgentToolCall,
  AgentToolGroup,
  AgentTurn,
} from './AgentTranscript';

const LAUNCH_CALLS: AgentToolCall[] = [
  {
    kind: 'search',
    query: 'Thursday launch',
    hits: [
      {
        kind: 'task',
        title: 'Fix the team invite handoff',
        snippet: 'Keep the invited team selected through sign-up.',
        time: '9:16 AM',
      },
      {
        kind: 'task',
        title: 'Write the launch announcement',
        snippet: 'Prepare the announcement for Thursday’s launch.',
        time: '9:32 AM',
      },
      {
        kind: 'document',
        title: 'Q3 launch plan',
        snippet: 'Send the customer email. Publish the changelog.',
        time: 'Sep 28',
      },
      {
        kind: 'email',
        title: 'Ready for Thursday',
        sender: 'Teo Nys',
        snippet: 'The invite flow is ready. Let’s run through the checklist.',
        time: '9:18 AM',
      },
      {
        kind: 'channel',
        title: 'launch',
        sender: 'Julia Westphal',
        snippet: 'Last pass before Thursday.',
        time: '9:20 AM',
      },
    ],
  },
  { kind: 'read-document', title: 'Q3 launch plan' },
  { kind: 'read-channel', channel: 'launch', count: 20 },
];

const LAUNCH_ANSWER =
  'Five launch tasks are still open:\n\n- @[Fix the team invite handoff](agent:invite) is urgent, and Teo is on it.\n- @[Write the launch announcement](agent:announcement) is in review. Julia’s first draft is ready.\n- @[Fix the deploy pipeline](agent:deploy) has a pull request up for Teo to review.\n- @[Prepare the launch checklist](agent:checklist) hasn’t started. It’s yours.\n- @[Send Dana the rollout plan](agent:follow-up) is yours too.\n\nThe @[Q3 launch plan](agent:plan) also still lists the customer email and the changelog.';

export const LAUNCH_PROMPT = 'What’s left before Thursday’s launch?';

/**
 * The hero's open Macro session. Task citations read live sample-workspace
 * state and open the task, just as a mention opens its item in the app.
 */
export function LaunchConversation(props: { workspace: DummyWorkspace }) {
  const w = props.workspace;
  const task = (id: string): AgentMention => ({
    kind: 'task',
    get task() {
      const item = w.data.tasks.find((entry) => entry.id === id);
      return (
        item && {
          status: item.status,
          priority: item.priority,
          owner: item.owner,
        }
      );
    },
    onOpen: () => w.openItem('tasks', id),
  });
  const mentions: Record<string, AgentMention> = {
    invite: task('invite'),
    announcement: task('announcement'),
    deploy: task('deploy'),
    checklist: task('checklist'),
    'follow-up': task('follow-up'),
    plan: { kind: 'document', onOpen: () => w.openItem('documents', 'plan') },
  };
  return (
    <>
      <AgentTurn>
        <AgentPrompt text={LAUNCH_PROMPT} />
      </AgentTurn>
      <AgentTurn>
        <AgentToolGroup calls={LAUNCH_CALLS} defaultOpen />
        <AgentAnswer text={LAUNCH_ANSWER} mentions={mentions} />
      </AgentTurn>
    </>
  );
}

import type { WorkspaceTask } from '../../core/dummy-workspace';
import { AgentAnswer } from '../agents/AgentTranscript';
import { rolloutCheckIn } from './call-fixtures';

/** Reuse the agent page's frozen StaticMarkdown/DocumentMention presentation. */
export function CallFollowupAnswer(props: {
  task: WorkspaceTask;
  onOpenTask: (trigger: HTMLButtonElement) => void;
  onOpenCall: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <div class="call-agent-text" role="group" aria-label="Agent answer">
      <AgentAnswer
        text={`Updated @[${props.task.title}](agent:training) using @[${rolloutCheckIn.title}](agent:call).\n\n- Reassigned **Teo → Julia**.\n- Added **Get Teo’s notes today**, **Update the slides**, and **Send the invite**.\n- Kept **Thursday at 10** and left the task **In Progress**.`}
        mentions={{
          training: {
            kind: 'task',
            task: {
              status: props.task.status,
              priority: props.task.priority,
              owner: props.task.owner,
            },
            onOpen: (trigger) => {
              if (trigger) props.onOpenTask(trigger);
            },
          },
          call: {
            kind: 'call',
            time: 'Oct 7, 9:48 AM',
            onOpen: (trigger) => {
              if (trigger) props.onOpenCall(trigger);
            },
          },
        }}
      />
    </div>
  );
}

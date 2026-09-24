import { TasksLifecycle } from '../../../../marketing/src/app/components/sections/TasksLifecycle';
import { HomepageConversation } from './HomepageConversation';
import { HomepageMention } from './HomepageMention';
import './homepage-task-conversation.css';

const InviteTask = () => (
  <HomepageMention
    kind="task"
    label="Fix the team invite handoff"
    description="Cursor implements. Claude reviews. Teo verifies both invite paths."
    href="#invite-task"
  />
);

/** The same cursor-driven task lifecycle shown on /tasks. */
export default function HomepageTaskConversation() {
  return (
    <div class="workspace-demo homepage-task-thread">
      <HomepageConversation
        messages={[
          {
            person: 'julia',
            text: (
              <>
                The invite in{' '}
                <HomepageMention
                  kind="md"
                  label="Q3 launch plan"
                  description="Thursday’s launch plan and owners."
                  href="#documents"
                />{' '}
                sends new teammates to an empty workspace.
              </>
            ),
          },
          {
            person: 'teo',
            text: (
              <>
                I’ll make a task.{' '}
                <span class="homepage-person-mention">@Cursor</span>, fix the
                redirect. <span class="homepage-person-mention">@Claude</span>,
                review the edge cases. I’ll test it before we ship.
              </>
            ),
          },
        ]}
      />
      <div class="homepage-task-animation" id="invite-task">
        <TasksLifecycle embedded />
      </div>
      <HomepageConversation
        messages={[
          {
            person: 'cursor',
            text: (
              <>
                The redirect now keeps the invited team. Added regression tests
                for new and existing accounts in <InviteTask />.
              </>
            ),
          },
          {
            person: 'claude',
            text: (
              <>
                Reviewed both paths. The team ID survives sign-up now.{' '}
                <span class="homepage-person-mention">@Teo</span>, ready for
                your final check.
              </>
            ),
          },
          {
            person: 'teo',
            text: 'Tested both. Everyone lands in the right team. We’re ready for Thursday.',
            reaction: { emoji: '🙌', label: 'Raised hands' },
          },
        ]}
      />
    </div>
  );
}

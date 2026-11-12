import { For, Show } from 'solid-js';
import MacroLogo from '../../../../assets/app-icons/macro-logo.svg';
import './paper-chat-call.css';

const createdTasks = [
  { title: 'Bulk archive shortcut', account: 'Northwind' },
  { title: 'Remap the command menu', account: 'Acme' },
];

function AgentSender(props: { time: string; session?: boolean }) {
  return (
    <div class="paper-chat-sender">
      <strong>Macro</strong>
      <span class="paper-chat-agent-badge">Agent</span>
      <span class="paper-chat-time">{props.time}</span>
      <Show when={props.session}>
        <span class="paper-chat-session">Open Session ↗</span>
      </Show>
    </div>
  );
}

function MacroAvatar() {
  return (
    <div class="paper-chat-avatar paper-chat-macro-avatar">
      <MacroLogo />
    </div>
  );
}

/**
 * A channel where the Macro agent first replies without being mentioned, then
 * does the work once it is asked to.
 */
export function PaperChatCall() {
  return (
    <div class="paper-chat-call">
      <div class="paper-chat-channel paper-feature-glass">
        <div class="paper-chat-channel-header">
          <span class="paper-chat-channel-hash">#</span>
          <strong>feature-requests</strong>
        </div>
        <div class="paper-chat-conversation">
          <div class="paper-chat-message">
            <div class="paper-chat-avatar">R</div>
            <div class="paper-chat-message-body">
              <div class="paper-chat-sender">
                <strong>Rahul Batra</strong>
                <span class="paper-chat-time">6:34 PM</span>
              </div>
              <div class="paper-chat-copy">
                Another customer asked for keyboard shortcuts today.
              </div>
            </div>
          </div>
          <div class="paper-chat-message">
            <MacroAvatar />
            <div class="paper-chat-message-body">
              <AgentSender time="6:34 PM" />
              <div class="paper-chat-copy">
                That’s 7 requests across 5 accounts now. Want me to add them to
                the Shortcuts project?
              </div>
            </div>
          </div>
          <div class="paper-chat-message">
            <div class="paper-chat-avatar">P</div>
            <div class="paper-chat-message-body">
              <div class="paper-chat-sender">
                <strong>Priya Shah</strong>
                <span class="paper-chat-time">6:36 PM</span>
              </div>
              <div class="paper-chat-copy">
                <span class="paper-chat-mention">@Macro</span> yes, and assign
                them to me.
              </div>
            </div>
          </div>
          <div class="paper-chat-message">
            <MacroAvatar />
            <div class="paper-chat-message-body">
              <AgentSender time="6:36 PM" session />
              <div class="paper-chat-copy">
                Done. They’re in Shortcuts, assigned to you.
              </div>
              <div class="paper-chat-tasks">
                <For each={createdTasks}>
                  {(task) => (
                    <div class="paper-chat-task">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect
                          x="3.5"
                          y="3.5"
                          width="17"
                          height="17"
                          rx="4.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        />
                        <path
                          d="m8 12.25 2.75 2.75L16 9.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                      <span class="paper-chat-task-title">{task.title}</span>
                      <span class="paper-chat-task-account">
                        {task.account}
                      </span>
                    </div>
                  )}
                </For>
                <div class="paper-chat-task-more">5 more in Shortcuts</div>
              </div>
            </div>
          </div>
        </div>
        <div class="paper-chat-composer">
          <span class="paper-chat-composer-plus">+</span>
          Type @ to share with #feature-requests
        </div>
      </div>
    </div>
  );
}

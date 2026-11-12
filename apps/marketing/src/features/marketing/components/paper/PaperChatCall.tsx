import { For } from 'solid-js';
import MacroLogo from '../../../../assets/app-icons/macro-logo.svg';
import './paper-chat-call.css';

const createdTasks = [
  { title: 'Bulk archive shortcut', account: 'Northwind' },
  { title: 'Remap the command menu', account: 'Acme' },
  { title: 'Jump to channel by number', account: 'Globex' },
];

/** A channel where the Macro agent answers a mention and lists the tasks it created. */
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
            <div class="paper-chat-avatar">P</div>
            <div class="paper-chat-message-body">
              <div class="paper-chat-sender">
                <strong>Priya Shah</strong>
                <span class="paper-chat-time">6:36 PM</span>
              </div>
              <div class="paper-chat-copy">
                <span class="paper-chat-mention">@Macro</span> which customers
                asked for this?
              </div>
            </div>
          </div>
          <div class="paper-chat-message">
            <div class="paper-chat-avatar paper-chat-macro-avatar">
              <MacroLogo />
            </div>
            <div class="paper-chat-message-body">
              <div class="paper-chat-sender">
                <strong>Macro</strong>
                <span class="paper-chat-agent-badge">Agent</span>
                <span class="paper-chat-time">6:36 PM</span>
                <span class="paper-chat-session">Open Session ↗</span>
              </div>
              <div class="paper-chat-copy">
                Found 7 requests across 5 accounts and added them to the
                Shortcuts project.
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
                <div class="paper-chat-task-more">4 more in Shortcuts</div>
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

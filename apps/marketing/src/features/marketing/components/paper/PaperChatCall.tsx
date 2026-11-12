import MacroLogo from '../../../../assets/app-icons/macro-logo.svg';
import './paper-chat-call.css';

/** A channel reply using the app's first-party avatar and sender-line session link. */
export function PaperChatCall() {
  return (
    <div class="paper-chat-call">
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
            <div class="paper-chat-from">
              from <span class="paper-chat-mention">Priya Shah</span>
            </div>
            <div class="paper-chat-copy">
              Found 7 requests across 5 accounts and added them to the Shortcuts
              project.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

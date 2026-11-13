import { HomepageConversation } from '../HomepageConversation';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { emailDraftMessages } from './emailDraftMessages';
import './email-draft-story.css';

/** The homepage's email example: the ask in chat, then the agent's draft in the composer. */
export function EmailDraftStory() {
  return (
    <div class="email-draft-story">
      <HomepageConversation messages={emailDraftMessages('/calls')} />
      <div class="homepage-feature-graphic homepage-feature-email">
        <HomepageEmailCompose />
      </div>
    </div>
  );
}

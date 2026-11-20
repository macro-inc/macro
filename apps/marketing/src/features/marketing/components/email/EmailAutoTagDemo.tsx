import Envelope from '@icon/system/regular/envelope-open.svg';
import { For } from 'solid-js';
import { demoEmails } from '../../core/demo-email';
import { EmailTags } from './frozen/EmailRows';
import './email-auto-tag-demo.css';

// One focused email shows the routine's tags in their inbox context.
export function EmailAutoTagDemo() {
  const emails = ['julia', 'dana', 'teo'].flatMap((id) =>
    demoEmails.filter((email) => email.id === id)
  );
  return (
    <div class="email-auto-tag-art">
      <div class="email-auto-tag-rows">
        <For each={emails}>
          {(email, index) => (
            <div
              class="email-auto-tag-row"
              classList={{ 'email-auto-tag-highlight': index() === 1 }}
            >
              <Envelope class="email-auto-tag-icon" aria-hidden="true" />
              <div class="email-auto-tag-message">
                <strong>{email.sender}</strong>
                <div class="email-auto-tag-subject">{email.subject}</div>
              </div>
              <EmailTags tags={email.tags} />
            </div>
          )}
        </For>
      </div>
      <div class="email-auto-tag-callout email-auto-tag-customer">
        <span>Customer</span>
      </div>
      <div class="email-auto-tag-callout email-auto-tag-followup">
        <span>Follow up</span>
      </div>
    </div>
  );
}

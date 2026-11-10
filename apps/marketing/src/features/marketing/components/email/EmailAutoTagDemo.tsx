import Envelope from '@icon/system/regular/envelope-open.svg';
import { For } from 'solid-js';
import { demoEmails } from '../../core/demo-email';
import { EmailTags } from './frozen/EmailRows';
import './email-auto-tag-demo.css';

// Illustrative inbox rows using the same tag pills as the other email demos.
export function EmailAutoTagDemo() {
  const emails = demoEmails.filter((email) =>
    ['dana', 'julia', 'teo'].includes(email.id)
  );
  return (
    <div class="email-auto-tag-art">
      <span class="email-auto-tag-annotation">Tagged by your routine</span>
      <div class="email-auto-tag-rows">
        <For each={emails}>
          {(email, index) => (
            <div
              class="email-auto-tag-row"
              classList={{ 'email-auto-tag-highlight': index() === 0 }}
            >
              <Envelope class="email-auto-tag-icon" />
              <div class="email-auto-tag-message">
                <div class="email-auto-tag-sender">
                  <strong>{email.sender}</strong>
                  <span>{email.time}</span>
                </div>
                <div class="email-auto-tag-subject">{email.subject}</div>
                <EmailTags tags={email.tags} />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

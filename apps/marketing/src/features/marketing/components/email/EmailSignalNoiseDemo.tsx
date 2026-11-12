import { createSignal } from 'solid-js';
import { emailPageInbox } from '../../core/email-demo-story';
import { EmailRows } from './frozen/EmailRows';
import { EmailShell } from './frozen/EmailShell';
import { EmailViewBar, type InboxTab } from './frozen/EmailViewBar';
import './email-feature-demos.css';
import './email-keyboard-stage.css';

/** The inbox's Signal and Noise tabs over the same demo mail. */
export function EmailSignalNoiseDemo() {
  const [tab, setTab] = createSignal<InboxTab>('signal');
  const emails = () =>
    emailPageInbox
      .filter((email) => !!email.noise === (tab() === 'noise'))
      .slice(0, 8);

  return (
    <div class="email-keyboard-demo email-feature-demo">
      <div class="email-keyboard-stage">
        <EmailShell label="Signal and Noise inbox tabs" showRail={false}>
          <EmailViewBar tab={tab()} onTab={setTab} />
          <div class="email-keyboard-content">
            {/* Rows are for reading here; opening a thread is the keyboard demo's job. */}
            <EmailRows emails={emails()} onOpen={() => {}} />
          </div>
        </EmailShell>
      </div>
    </div>
  );
}

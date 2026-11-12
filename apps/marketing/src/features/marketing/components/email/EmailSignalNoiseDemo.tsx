import Signal from '@icon/system/regular/wave-sine.svg';
import Noise from '@icon/system/regular/waveform.svg';
import { createSignal, For } from 'solid-js';
import { emailPageInbox } from '../../core/email-demo-story';
import { EmailRows } from './frozen/EmailRows';
import { EmailShell } from './frozen/EmailShell';
import './email-feature-demos.css';
import './email-keyboard-stage.css';
import './email-signal-noise.css';

const tabs = [
  { id: 'signal', label: 'Signal', icon: Signal },
  { id: 'noise', label: 'Noise', icon: Noise },
] as const;

/** The inbox's Signal and Noise tabs over the same demo mail. */
export function EmailSignalNoiseDemo() {
  const [tab, setTab] = createSignal<'signal' | 'noise'>('signal');
  const emails = () =>
    emailPageInbox
      .filter((email) => !!email.noise === (tab() === 'noise'))
      .slice(0, 8);

  return (
    <div class="email-keyboard-demo email-feature-demo">
      <div class="email-keyboard-stage">
        <EmailShell label="Signal and Noise inbox tabs" showRail={false}>
          <header class="email-feature-toolbar">
            <div class="email-signal-tabs" role="group" aria-label="Inbox tab">
              <For each={tabs}>
                {(item) => (
                  <button
                    type="button"
                    aria-pressed={tab() === item.id}
                    onClick={() => setTab(item.id)}
                  >
                    <item.icon aria-hidden="true" />
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            <span class="email-toolbar-secondary">
              {emails().length} emails
            </span>
          </header>
          <div class="email-keyboard-content">
            {/* Rows are for reading here; opening a thread is the keyboard demo's job. */}
            <EmailRows emails={emails()} onOpen={() => {}} />
          </div>
        </EmailShell>
      </div>
    </div>
  );
}

import Microphone from '@phosphor/microphone.svg';
import Paperclip from '@phosphor/paperclip.svg';
import { ComposerSurface, SendButton } from '@ui';
import { createSignal } from 'solid-js';
import { InputActionButton } from './ActionButton';
import { Layout } from './ComposerLayout';

// The actual ChannelInput layout, ComposerSurface, InputActionButton and
// SendAction presentation with a website-local draft instead of app commands.
export function ChannelComposer(props: { onSend: (message: string) => void }) {
  const [draft, setDraft] = createSignal('');
  const send = () => {
    if (!draft().trim()) return;
    props.onSend(draft().trim());
    setDraft('');
  };
  return (
    <ComposerSurface class="relative">
      <Layout oneLineInput={!draft().includes('\n') && draft().length < 70}>
        <Layout.Body>
          <Layout.Editor>
            <textarea
              class="mail-channel-input"
              aria-label="Message #launch"
              placeholder="Message #launch"
              rows={1}
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </Layout.Editor>
        </Layout.Body>
        <Layout.ActionsLeft>
          <InputActionButton label="Attach files" disabled>
            <Paperclip />
          </InputActionButton>
        </Layout.ActionsLeft>
        <Layout.ActionsRight>
          <InputActionButton label="Dictation" disabled>
            <Microphone />
          </InputActionButton>
          <SendButton
            appearance="composer"
            aria-label="Send demo message"
            data-input-action="send"
            disabled={!draft().trim()}
            onClick={send}
          />
        </Layout.ActionsRight>
      </Layout>
    </ComposerSurface>
  );
}

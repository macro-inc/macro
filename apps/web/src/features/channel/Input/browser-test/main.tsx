import '../../../../index.css';
import { Button } from '@ui/components/Button';
import { Checkbox } from '@ui/components/Checkbox';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { MessagePrivacyControl } from '../MessagePrivacyControl';

document.documentElement.dataset.touchDevice = String(
  navigator.maxTouchPoints > 0
);
function Fixture() {
  const [privateMessage, setPrivateMessage] = createSignal(false);
  const [ephemeral, setEphemeral] = createSignal(false);
  return (
    <main class="mx-auto flex min-h-dvh max-w-xl flex-col justify-end gap-6 bg-surface p-4 pb-12 text-ink">
      <div>
        <h1 class="text-lg font-semibold">Design team</h1>
        <p class="text-sm text-ink-muted">
          A shared channel with a private agent exchange.
        </p>
      </div>
      <Checkbox
        checked={ephemeral()}
        onChange={(checked) => {
          setEphemeral(checked);
          if (checked) setPrivateMessage(true);
        }}
      >
        <Checkbox.Control />
        <Checkbox.Label>Ephemeral agent mentioned</Checkbox.Label>
      </Checkbox>
      <div class="rounded-xl border border-edge bg-surface">
        <MessagePrivacyControl
          private={privateMessage()}
          locked={ephemeral()}
          onChange={setPrivateMessage}
          reason="@Research is an ephemeral agent. Its threads are only visible to you."
        />
        <div class="px-3 py-4 text-sm">
          @Research help me think through this before I share it.
        </div>
        <div class="flex justify-end p-2">
          <Button size="sm">Send</Button>
        </div>
      </div>
    </main>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);

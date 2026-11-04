import '@fontsource-variable/inter';
import '../../../index.css';
import { SidePanel } from '@components/app/side-panel';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { EmailPeopleSection } from '../component/sidepanel/EmailPeopleSection';

for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

function Fixture() {
  const [message, setMessage] = createSignal('');
  const onMessage = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string')
      setMessage(event.detail);
  };
  document.addEventListener('email-people-preview-message', onMessage);
  onCleanup(() =>
    document.removeEventListener('email-people-preview-message', onMessage)
  );

  return (
    <main class="relative flex h-dvh flex-col bg-page text-ink">
      <SidePanel.Root floating defaultOpen={false} persistKey="email-preview">
        <div class="flex items-center justify-between p-3">
          <h1 class="text-lg font-semibold">Quarterly engine review</h1>
          <SidePanel.Toggle />
        </div>
        <div class="relative min-h-0 flex-1">
          <SidePanel.Layout headerToggle={false}>
            <div class="p-4 text-sm text-ink-muted">
              Thanks for the update. Let's meet next week.
              <Show when={message()}>
                <p role="status" aria-label="Preview action" class="mt-4">
                  {message()}
                </p>
              </Show>
            </div>
            <EmailPeopleSection order={10} />
          </SidePanel.Layout>
        </div>
      </SidePanel.Root>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
render(() => <Fixture />, root);

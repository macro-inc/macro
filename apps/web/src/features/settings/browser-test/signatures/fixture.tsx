import '@fontsource-variable/inter';
import '../../../../index.css';
import { SignaturePreview } from '@app/features/email-compose/components/signature-preview';
import { isMobile } from '@core/mobile/isMobile';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import {
  SettingsButton as Button,
  SettingsPage,
  SettingsSection,
  SettingsSurface,
} from '../../primitives';
import { SignatureSection } from '../../SignatureSection';
import {
  link,
  queryClient,
  status,
  useEmailLinksQuery,
  useEmailSignature,
} from './services';

function Fixture() {
  const [mounted, setMounted] = createSignal(true);
  const signature = useEmailSignature(() => link.id);
  const links = useEmailLinksQuery();
  onMount(() => {
    const dark = new URLSearchParams(location.search).has('dark');
    for (const [key, value] of Object.entries(
      themeCssVars(dark ? macroDarkTheme : macroLightTheme)
    ))
      document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!dark);
  });
  return (
    <main class="h-dvh bg-panel text-ink">
      <SettingsPage
        title="Email"
        description="Manage your inboxes and the signature you send with each account."
      >
        <SettingsSection
          title="Signatures"
          description="Create a signature for each email account, import from Gmail, or paste your HTML. Preview it before sending."
        >
          <Show when={mounted()}>
            <For each={links.isSuccess ? links.data.links : []}>
              {(inbox) => <SignatureSection link={inbox} />}
            </For>
          </Show>
          <p role="status" class="text-sm text-ink-muted">
            {status()}
          </p>
        </SettingsSection>
        <SettingsSection title="New email preview">
          <SettingsSurface class="p-4">
            <p class="text-sm">Hello,</p>
            <Show when={signature()}>
              {(html) => (
                <SignaturePreview
                  html={html()}
                  mobile={isMobile()}
                  onDismiss={() => {}}
                />
              )}
            </Show>
          </SettingsSurface>
        </SettingsSection>
        <Button variant="ghost" onClick={() => setMounted((value) => !value)}>
          {mounted() ? 'Leave settings' : 'Reopen settings'}
        </Button>
      </SettingsPage>
    </main>
  );
}
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>
    ),
    root
  );

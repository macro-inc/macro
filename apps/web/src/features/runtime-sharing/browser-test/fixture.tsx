import '@fontsource-variable/inter';
import '../../../index.css';
import { queryClient } from '@queries/client';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button, ImperativeDialogHost } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { PendingRequestsSection } from '../../settings/components/pending-requests-section';
import { TeammateRuntimesSection } from '../../settings/components/teammate-runtimes-section';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { RuntimeShareDialog } from '../views/RuntimeShareDialog';
import { OWNER_ID } from './preview-adapters';

document.documentElement.dataset.themeLight = 'true';
for (const [token, value] of Object.entries(macroLightTheme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

function Fixture() {
  const directory = useHarnessDirectoryQuery();
  const [open, setOpen] = createSignal(false);
  const mine = () =>
    directory.isSuccess
      ? directory.data.find(
          (harness) =>
            harness.owner.type === 'user' && harness.owner.user_id === OWNER_ID
        )
      : undefined;
  return (
    <main class="@container flex w-full max-w-xl flex-col gap-4 p-4">
      <Button onClick={() => setOpen(true)}>Open Share menu</Button>
      <PendingRequestsSection />
      <TeammateRuntimesSection canRemoveShared={false} onRemove={() => {}} />
      <Show when={mine()}>
        {(harness) => (
          <RuntimeShareDialog
            harness={harness()}
            open={open()}
            onOpenChange={setOpen}
          />
        )}
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
        <ImperativeDialogHost />
      </QueryClientProvider>
    ),
    root
  );

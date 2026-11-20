import '../../../../index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryClient } from '@queries/client';
import { Route, Router } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createSignal, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CrmWorkspaceView } from '../../views/crm-workspace';
import { CrmEmptyState } from '../../views/empty-state';
import {
  authority,
  navigate,
  openRecord,
  recordDisposals,
  recordMounts,
} from './workspace-adapters';

applyTheme('macro-light');
document.documentElement.dataset.touchDevice = String(isTouchDevice());
const params = new URLSearchParams(location.search);
if (params.has('collapsed'))
  localStorage.setItem('macro:pref:view-sidebar:collapsed:crm', 'true');

function Fixture() {
  authority.setSession('fixture-viewer');
  const [failed, setFailed] = createSignal(false);
  const refresh = async () => {
    try {
      await authority.refresh();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  onMount(() => {
    fireAndForget(refresh(), 'crm.access.fixture');
  });
  return (
    <main class="flex h-dvh flex-col bg-panel text-ink">
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-muted p-3">
        <Button onClick={refresh}>Check access</Button>
        <Button onClick={() => navigate('active')}>Open records route</Button>
        <Button onClick={() => navigate('pipeline:shared')}>
          Open shared pipeline
        </Button>
        <Button onClick={openRecord}>Open record route</Button>
        <Show when={failed()}>
          <p role="alert">Access could not be refreshed</p>
        </Show>
      </div>
      <output hidden data-testid="record-mounts">
        {recordMounts()}
      </output>
      <output hidden data-testid="record-disposals">
        {recordDisposals()}
      </output>
      <div class="flex min-h-0 flex-1">
        <CrmWorkspaceView>
          {() => (
            <Show when={!params.has('no-team')} fallback={<CrmEmptyState />}>
              <div class="p-6 pt-[max(1.5rem,var(--mobile-content-inset-top,0px))]">
                <h1 class="text-xl font-semibold">Company records</h1>
                <p>Private record content</p>
              </div>
            </Show>
          )}
        </CrmWorkspaceView>
      </div>
    </main>
  );
}
render(
  () => (
    <Router
      root={(props) => (
        <QueryClientProvider client={queryClient}>
          {props.children}
        </QueryClientProvider>
      )}
    >
      <Route path="*all" component={Fixture} />
    </Router>
  ),
  document.getElementById('root')!
);

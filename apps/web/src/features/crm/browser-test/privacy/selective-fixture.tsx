import '@fontsource-variable/inter';
import { ViewShell } from '@app/components/view-shell';
import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { SettingsSidebar } from '@app/features/settings/components/settings-sidebar';
import { MobileSettingsSheet } from '@app/features/settings/MobileSettingsSheet';
import { SettingsPage } from '@app/features/settings/primitives';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { queryClient, queryPersistence } from '@queries/client';
import { crmProtectedQueryKey } from '@queries/crm-cache-scope';
import { previewKeys } from '@queries/preview/keys';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { CrmEmailPrivacySettings } from '../../views/email-privacy';
import { finishPolicyRead, policyCalls } from './policy-adapter';
import { finishPrivacyRead, lastChange } from './preview-adapters';

applyTheme('macro-light');
for (const [id, type, name] of [
  ['00000000-0000-4000-8000-000000000021', 'crm_contact', 'Example contact'],
  ['00000000-0000-4000-8000-000000000022', 'crm_company', 'Example company'],
])
  queryClient.setQueryData(previewKeys.item(id).queryKey, {
    id,
    type,
    name,
    rawName: name,
    access: 'access',
    loading: false,
  });
const groups = SETTINGS_TAB_GROUPS.filter(
  (group) => !group.items.some((item) => item.tab === 'Admin')
);
export function SelectiveSettingsFixture() {
  const [open, setOpen] = createSignal(true);
  const [retired, setRetired] = createSignal(false);
  const params = new URLSearchParams(location.search);
  const content = () => (
    <Suspense fallback={<ListSkeleton.Bar class="m-6 h-4 w-32" />}>
      <Show when={params.has('retirement')}>
        <Button
          onClick={async () => {
            setRetired(false);
            await cacheSessionGeneration.transition(async () => {
              await queryClient.cancelQueries();
              await queryPersistence.retire(crmProtectedQueryKey);
            });
            await queryClient.refetchQueries({ type: 'active' });
            setRetired(true);
          }}
        >
          Retire CRM cache
        </Button>
      </Show>
      <CrmEmailPrivacySettings
        renderOverview={(body) => (
          <SettingsPage
            title="CRM"
            description="Manage email sharing and shape your team’s deal pipeline."
          >
            <Show when={params.has('policy-pending')}>
              <Button onClick={finishPolicyRead}>Finish policy load</Button>
            </Show>
            <Show when={params.has('privacy-pending')}>
              <Button onClick={finishPrivacyRead}>Finish privacy load</Button>
            </Show>
            {body}
          </SettingsPage>
        )}
      />
    </Suspense>
  );
  return (
    <div class="h-dvh bg-page text-ink font-sans">
      <output hidden data-testid="policy-calls">
        {JSON.stringify(policyCalls())}
      </output>
      <output hidden data-testid="last-change">
        {lastChange()}
      </output>
      <output hidden data-testid="retirement-complete">
        {String(retired())}
      </output>
      <Show
        when={!isTouchDevice()}
        fallback={
          <MobileSettingsSheet
            open={open()}
            page="CRM"
            groups={groups}
            name="Example member"
            email="member@example.com"
            avatar="M"
            onClose={() => setOpen(false)}
            onNavigate={() => {}}
            onLogout={() => {}}
            renderPage={content}
          />
        }
      >
        <ViewShell.Root main={{ preferredWidth: 960 }}>
          <ViewShell.Aside>
            <SettingsSidebar
              groups={groups}
              results={[]}
              searchable
              searchQuery=""
              onSearchQueryChange={() => {}}
              isItemActive={(tab) => tab === 'CRM'}
              onSelect={() => {}}
              onSelectResult={() => {}}
            />
          </ViewShell.Aside>
          <ViewShell.Main>{content()}</ViewShell.Main>
        </ViewShell.Root>
      </Show>
    </div>
  );
}

import '@fontsource-variable/inter';
import { ViewShell } from '@app/components/view-shell';
import { SettingsSidebar } from '@app/features/settings/components/settings-sidebar';
import { MobileSettingsSheet } from '@app/features/settings/MobileSettingsSheet';
import { SettingsPage } from '@app/features/settings/primitives';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import { createSignal, Show } from 'solid-js';
import { CrmEmailPrivacySettings } from '../../views/email-privacy';
import { policyCalls } from './policy-adapter';
import { lastChange } from './preview-adapters';

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
  const content = () => (
    <CrmEmailPrivacySettings
      renderOverview={(body) => (
        <SettingsPage
          title="CRM"
          description="Manage email sharing and shape your team’s deal pipeline."
        >
          {body}
        </SettingsPage>
      )}
    />
  );
  return (
    <div class="h-dvh bg-page text-ink font-sans">
      <output hidden data-testid="policy-calls">
        {JSON.stringify(policyCalls())}
      </output>
      <output hidden data-testid="last-change">
        {lastChange()}
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

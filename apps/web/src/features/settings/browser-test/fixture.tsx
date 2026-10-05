import '@fontsource-variable/inter';
import '../../../index.css';
import { ViewShell } from '@app/components/view-shell';
import type { SettingsTab } from '@core/constant/SettingsState';
import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { ToggleSwitch } from '@ui';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { themeCssVars } from '../../theme/utils/themeColorTokens';
import { Appearance } from '../Appearance';
import { SettingsSearchTarget } from '../components/settings-search-target';
import { SettingsSidebar } from '../components/settings-sidebar';
import { SignatureForm } from '../components/signature-form';
import {
  type SettingsSearchResult,
  searchSettings,
} from '../core/settings-search';
import { MobileSettingsSheet } from '../MobileSettingsSheet';
import {
  SettingsButton as Button,
  SettingsCard,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from '../primitives';
import { Shortcuts } from '../Shortcuts';

function Fixture() {
  const [tab, setTab] = createSignal<SettingsTab>('Email');
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal<SettingsSearchResult>();
  const [dark, setDark] = createSignal(false);
  const [narrow, setNarrow] = createSignal(false);
  const [mobile, setMobile] = createSignal(false);
  const [mobilePage, setMobilePage] = createSignal<SettingsTab>();
  const applyTheme = (value: boolean) => {
    setDark(value);
    for (const [key, token] of Object.entries(
      themeCssVars(value ? macroDarkTheme : macroLightTheme)
    ))
      document.documentElement.style.setProperty(key, token);
    document.documentElement.style.colorScheme = value ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!value);
  };
  onMount(() => applyTheme(false));
  const groups = SETTINGS_TAB_GROUPS.filter(
    (group) => group.label !== 'Admin'
  ).map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.searchOnly),
  }));
  const results = createMemo(() =>
    searchSettings(SETTINGS_TAB_GROUPS, query())
  );
  const title = (page: SettingsTab) =>
    SETTINGS_TAB_GROUPS.flatMap((group) => group.items).find(
      (item) => item.tab === page
    )?.label ?? page;
  const sampleContent = (page: SettingsTab) => (
    <Show
      when={page === 'Email'}
      fallback={
        <SettingsPage
          title={title(page)}
          description="Sample settings for navigation and layout verification."
        >
          <SettingsSection title="Profile">
            <SettingsCard>
              <SettingsRow label="Name">Alex Morgan</SettingsRow>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection title="Color Theme">
            <SettingsCard>
              <SettingsRow label="Dark mode">
                <ToggleSwitch checked={dark()} onChange={applyTheme} />
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection title="Delivery">
            <SettingsCard>
              <SettingsRow
                label="Email digest"
                description="Get a summary of your notifications."
              >
                <ToggleSwitch />
              </SettingsRow>
            </SettingsCard>
          </SettingsSection>
        </SettingsPage>
      }
    >
      <SettingsPage
        title="Email"
        description="Manage your inboxes and the signature you send with each account."
      >
        <SettingsSection
          title="Accounts"
          description="Connect Gmail accounts and manage their sync with Macro."
        >
          <SettingsCard>
            <For each={['alex@example.com', 'alex@gmail.com']}>
              {(email) => (
                <SettingsRow label={email} description="Up to date">
                  <Show when={email === 'alex@example.com'}>
                    <Button variant="outline" size="md">
                      Enable calendar
                    </Button>
                  </Show>
                  <Button variant="ghost" size="md">
                    Remove
                  </Button>
                </SettingsRow>
              )}
            </For>
            <SettingsRow
              label="Add another inbox"
              description="Connect more Gmail accounts."
            >
              <Button variant="outline" size="md">
                Add account
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
        <SettingsSection
          title="Signatures"
          description="Create a signature for each of your email accounts. Format text, add links, or insert an image below."
        >
          <For each={['alex@example.com', 'alex@gmail.com']}>
            {(email) => <FixtureSignature email={email} />}
          </For>
        </SettingsSection>
      </SettingsPage>
    </Show>
  );
  const content = (page: SettingsTab) => (
    <Show when={page !== 'Appearance'} fallback={<Appearance />}>
      <Show when={page !== 'Shortcuts'} fallback={<Shortcuts />}>
        {sampleContent(page)}
      </Show>
    </Show>
  );
  return (
    <div class="h-dvh bg-panel text-ink flex flex-col">
      <Show when={narrow()}>
        <style>{`.mobile-settings-sheet {max-width:390px; margin-inline:auto;}`}</style>
      </Show>
      <div class="p-2 flex items-center gap-3 border-b border-edge-muted text-xs">
        <span>Local fixture · changes stay in this preview</span>
        <Button size="sm" onClick={() => setNarrow(!narrow())}>
          Narrow layout
        </Button>
        <Button size="sm" onClick={() => applyTheme(!dark())}>
          Toggle theme
        </Button>
        <Button size="sm" onClick={() => setMobile(true)}>
          Mobile settings
        </Button>
      </div>
      <div class="min-h-0 flex-1">
        <ViewShell.Root main={{ preferredWidth: 960 }}>
          <ViewShell.Aside>
            <SettingsSidebar
              groups={groups}
              results={results()}
              selectedResultId={selected()?.id}
              searchQuery={query()}
              onSearchQueryChange={setQuery}
              isItemActive={(item) => item === tab()}
              onSelect={(page) => {
                setSelected(undefined);
                setTab(page);
              }}
              onSelectResult={(result) => {
                setTab(result.tab);
                setSelected({ ...result });
              }}
              onLogout={() => {}}
            />
          </ViewShell.Aside>
          <ViewShell.Main>
            <div class="h-full min-h-0">
              <SettingsSearchTarget result={selected()}>
                {content(tab())}
              </SettingsSearchTarget>
            </div>
          </ViewShell.Main>
        </ViewShell.Root>
      </div>
      <MobileSettingsSheet
        open={mobile()}
        page={mobilePage()}
        groups={groups}
        searchGroups={SETTINGS_TAB_GROUPS}
        name="Alex Morgan"
        email="alex@example.com"
        avatar="A"
        onClose={() => {
          setMobile(false);
          setMobilePage(undefined);
        }}
        onNavigate={setMobilePage}
        onLogout={() => {}}
        renderPage={content}
      />
    </div>
  );
}
function FixtureSignature(props: { email: string }) {
  const [saved, setSaved] = createSignal('<p>Alex Morgan</p>');
  const [value, setValue] = createSignal(saved());
  const [replies, setReplies] = createSignal(true);
  const [status, setStatus] = createSignal('');
  const [importing, setImporting] = createSignal(false);
  let api: { setContent: (html: string) => void } | undefined;
  return (
    <>
      <SignatureForm
        email={props.email}
        value={value()}
        onInput={setValue}
        onReady={(editor) => {
          api = editor;
        }}
        onSave={() => {
          setSaved(value());
          setStatus('Signature saved');
        }}
        onClear={() => {
          setValue('');
          setSaved('');
          api?.setContent('');
          setStatus('Signature cleared');
        }}
        onImport={() => {
          setImporting(true);
          setTimeout(() => {
            const imported = `<p><strong>Alex Morgan</strong></p><p>Product Lead · <a href="https://example.com">example.com</a></p>`;
            setValue(imported);
            setSaved(imported);
            api?.setContent(imported);
            setImporting(false);
            setStatus('Signature imported from Gmail');
          }, 600);
        }}
        importing={importing()}
        dirty={saved() !== value()}
        hasContent={!!value()}
        pending={false}
        replies={replies()}
        onRepliesChange={setReplies}
        mobile={false}
      />
      <Show when={status()}>
        <p role="status" class="text-sm text-ink-muted">
          {status()}
        </p>
      </Show>
    </>
  );
}
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);

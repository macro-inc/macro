import '@fontsource-variable/inter';
import '../../../index.css';
import { MenuItem } from '@core/component/ContextMenu';
import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { UserContextProvider } from '@core/context/user';
import PencilIcon from '@phosphor/pencil-simple.svg';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { SettingsSidebar } from '../../../features/settings/components/settings-sidebar';
import { LanguageSettings } from '../../../features/settings/LanguageSettings';
import { macroLightTheme } from '../../../features/theme/themes/macro-light';
import { themeCssVars } from '../../../features/theme/utils/themeColorTokens';
import { authKeys } from '../../queries/auth/keys';
import { teamKeys } from '../../queries/team/keys';
import type { TranslationKey } from '../dictionary';
import { setInterfaceLanguage, t } from '../i18n';
import { isLanguage } from '../languages';
import en from '../locales/en';

/**
 * Menus rendered with the production primitives and content widths, in the
 * language from `?lang=`, so long translations and CJK text can be checked
 * for clipping without a signed-in app.
 */
const MENUS: {
  title: string;
  contentClass: string;
  keys: TranslationKey[];
}[] = [
  {
    title: 'Entity actions',
    contentClass:
      'min-w-64 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted',
    keys: [
      'entityActions.markDone',
      'entityActions.markNotDone',
      'entityActions.markUnread',
      'entityActions.openInNewSplit',
      'entityActions.rename',
      'entityActions.setChannelPicture',
      'entityActions.removeChannelPicture',
      'entityActions.unfavorite',
      'entityActions.snoozeNotifications',
      'entityActions.unmuteNotifications',
      'entityActions.remindMe',
      'entityActions.addTag',
      'entityActions.addToProject',
      'entityActions.moveToFolder',
      'entityActions.removeFromFolder',
      'entityActions.duplicate',
      'entityActions.copyLink',
      'entityActions.copyBranchName',
      'entityActions.copyId',
      'entityActions.share',
      'entityActions.senderToSignal',
      'entityActions.senderToNoise',
      'entityActions.blockSender',
      'entityActions.delete',
    ],
  },
  {
    title: 'Split header',
    contentClass: 'min-w-60 max-w-[min(22rem,calc(100vw-1rem))]',
    keys: [
      'splitMenu.newSplitLeft',
      'splitMenu.newSplitRight',
      'splitMenu.duplicateSplit',
      'splitMenu.swapSplitLeft',
      'splitMenu.swapSplitRight',
      'splitMenu.spotlightSplit',
      'splitMenu.minimizeSplit',
      'splitMenu.closeSplit',
      'splitMenu.closeOtherSplits',
      'splitMenu.resetSizes',
      'splitMenu.copyDebugInfo',
    ],
  },
  {
    title: 'List controls',
    contentClass: 'min-w-40',
    keys: [
      'viewMenus.layoutList',
      'viewMenus.layoutBoard',
      'viewMenus.layoutGantt',
      'viewMenus.sortLastViewed',
      'viewMenus.sortLastUpdated',
      'viewMenus.sortDateCreated',
      'viewMenus.clearFilters',
    ],
  },
  {
    title: 'More',
    contentClass: 'min-w-[14rem]',
    keys: ['nav.customizeSidebar', 'nav.moreOptions'],
  },
];

// Every label in the namespaces that render in context and dropdown menus, at
// the narrowest menu width, so a new or changed translation is checked without
// listing it above. Sentences (toasts, descriptions, placeholders) wrap or show
// elsewhere and are left out; the command menu and sidebars are wider.
const LABEL_NAMESPACES = [
  'channelLabels',
  'entityActions',
  'splitMenu',
  'viewMenus',
] as const satisfies (keyof typeof en)[];
const NOT_A_LABEL =
  /toast|description|tagline|placeholder|example|hint|tooltip|aria|error|failed/i;
const LABEL_MENUS: (typeof MENUS)[number][] = LABEL_NAMESPACES.map(
  (namespace) => ({
    title: `All ${namespace}`,
    contentClass: 'min-w-56 max-w-[22rem] text-xs text-ink-muted',
    keys: Object.keys(en[namespace])
      .filter((message) => !NOT_A_LABEL.test(message))
      .map((message) => `${namespace}.${message}` as TranslationKey),
  })
);

function Menu(props: (typeof MENUS)[number]) {
  return (
    <div
      class="w-[23rem] shrink-0"
      style={{ height: `${props.keys.length * 2.1 + 4}rem` }}
      data-menu={props.title}
    >
      <Dropdown open modal={false} placement="bottom-start">
        <Dropdown.Trigger>{props.title}</Dropdown.Trigger>
        <Dropdown.Content class={props.contentClass} portalScope="local">
          <For each={props.keys}>
            {(key) => <MenuItem icon={PencilIcon} text={t(key)} />}
          </For>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}

const OWNER = 'macro|owner@acme.test';

function Fixture() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(authKeys.userLanguage.queryKey, { language: null });
  // A signed-in team owner, so the team language dropdown is enabled.
  queryClient.setQueryData(authKeys.userInfo.queryKey, {
    id: OWNER,
    email: 'owner@acme.test',
    permissions: [],
  });
  queryClient.setQueryData(teamKeys.currentTeam.queryKey, {
    team: { id: 'team', name: 'Acme', language: 'de' },
    members: [{ user_id: OWNER, role: 'owner' }],
  });
  const groups = SETTINGS_TAB_GROUPS.filter(
    (group) => !group.items.some((item) => item.tab === 'Admin')
  );
  return (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <div class="flex gap-6 bg-panel p-6 text-ink">
          <div class="w-60 shrink-0" data-surface="settings-sidebar">
            <SettingsSidebar
              groups={groups}
              results={[]}
              searchQuery=""
              onSearchQueryChange={() => {}}
              isItemActive={(tab) => tab === 'Appearance'}
              onSelect={() => {}}
              onSelectResult={() => {}}
            />
          </div>
          <div class="flex flex-1 flex-col gap-6">
            <div class="flex flex-col flex-wrap content-start gap-x-4 h-[56rem]">
              <For each={MENUS}>{(menu) => <Menu {...menu} />}</For>
              <div
                class="@container w-[36rem]"
                data-surface="language-settings"
              >
                <LanguageSettings />
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-start gap-4 bg-panel p-6">
          <For each={LABEL_MENUS}>{(menu) => <Menu {...menu} />}</For>
        </div>
        <Show
          when={
            document.documentElement.lang === 'en' ||
            t('settingsLanguage.sectionTitle') !== 'Language'
          }
        >
          <span data-translation-ready />
        </Show>
      </UserContextProvider>
    </QueryClientProvider>
  );
}

for (const [key, token] of Object.entries(themeCssVars(macroLightTheme)))
  document.documentElement.style.setProperty(key, token);
const requested = new URLSearchParams(location.search).get('lang');
setInterfaceLanguage(isLanguage(requested) ? requested : 'en');
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);

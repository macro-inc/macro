import '@app/index.css';
import { IMPORT_CATEGORIES } from '@app/features/connector-import/core/catalog';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { PromoCard } from '../components/promo-card';
import {
  CALENDAR_ACCOUNTS_PROMOTION,
  HOME_SETUP_PROMOTION,
  PULL_REQUEST_REPOSITORIES_PROMOTION,
} from '../core/promotions';

// The real card with each host's copy, at the default sidebar width. Actions
// record what they would do instead of leaving the page.
const [lastAction, setLastAction] = createSignal('');

const CARDS: {
  sidebar: string;
  copy: Pick<
    typeof CALENDAR_ACCOUNTS_PROMOTION,
    'logos' | 'headline' | 'pitch' | 'action'
  >;
  secondary?: string;
}[] = [
  {
    sidebar: 'Home',
    copy: HOME_SETUP_PROMOTION,
    secondary: HOME_SETUP_PROMOTION.secondaryAction,
  },
  {
    sidebar: 'Chat',
    copy: {
      ...IMPORT_CATEGORIES.channels,
      logos: [...IMPORT_CATEGORIES.channels.providers],
      action: 'Import Slack',
    },
    secondary: 'New channel',
  },
  { sidebar: 'Calendar', copy: CALENDAR_ACCOUNTS_PROMOTION },
  { sidebar: 'Pull requests', copy: PULL_REQUEST_REPOSITORIES_PROMOTION },
];

function Sidebar(props: (typeof CARDS)[number]) {
  const [hidden, setHidden] = createSignal(false);
  return (
    <aside
      class="flex h-[440px] w-64 flex-col bg-panel px-2 py-3"
      aria-label={`${props.sidebar} sidebar`}
    >
      <p class="px-2 text-sm font-semibold text-ink">{props.sidebar}</p>
      <div class="mt-auto">
        <Show when={!hidden()}>
          <PromoCard
            logos={props.copy.logos}
            headline={props.copy.headline}
            pitch={props.copy.pitch}
            action={{
              label: props.copy.action,
              onClick: () => setLastAction(props.copy.action),
            }}
            secondaryAction={
              props.secondary
                ? {
                    label: props.secondary,
                    onClick: () => setLastAction(props.secondary ?? ''),
                  }
                : undefined
            }
            dismissLabel={`Dismiss ${props.copy.action.toLowerCase()}`}
            onDismiss={() => setHidden(true)}
          />
        </Show>
      </div>
    </aside>
  );
}

function Fixture() {
  return (
    <main class="flex min-h-screen gap-6 bg-page p-6">
      <For each={CARDS}>{(card) => <Sidebar {...card} />}</For>
      <output aria-label="Last action" class="text-xs text-ink-muted">
        {lastAction()}
      </output>
    </main>
  );
}

// Apply dark explicitly too: `dark-mode:` styles key off the theme attribute.
applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? 'Macro Light'
    : 'Macro Dark'
);
const root = document.getElementById('root');
if (root) render(() => <Fixture />, root);

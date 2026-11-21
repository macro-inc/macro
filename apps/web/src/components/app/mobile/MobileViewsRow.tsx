import type { MobileSearchSession } from '@app/features/command/mobile/mobileSearchState';
import type { EntitySearchCategory } from '@app/features/command/queries/entity-search';
import { type TranslationKey, t } from '@app/lib/i18n';
import { type PillTabItem, PillTabs } from './PillTabs';

const categoryPill = (
  value: EntitySearchCategory,
  key: TranslationKey
): PillTabItem<EntitySearchCategory> => ({
  value,
  get label() {
    return t(key);
  },
});

const CATEGORIES: PillTabItem<EntitySearchCategory>[] = [
  categoryPill('all', 'mobile.all'),
  categoryPill('email', 'nav.email'),
  categoryPill('chats', 'nav.agents'),
  categoryPill('documents', 'nav.files'),
  categoryPill('tasks', 'nav.tasks'),
  categoryPill('projects', 'mobile.projects'),
  categoryPill('channels', 'nav.channels'),
  categoryPill('dms', 'mobile.people'),
];

/** Search categories filter entities directly without navigating between views. */
export function MobileViewsRow(props: { session: MobileSearchSession }) {
  const category = () => props.session.category();
  return (
    <header
      aria-label="Search filters"
      class="pointer-events-none absolute inset-x-0 top-0 z-split-panel-chrome flex pt-[calc(var(--safe-top,0px)+0.5rem)]"
    >
      <PillTabs
        scrollable
        contentClass="px-(--mobile-chrome-gutter)"
        items={CATEGORIES}
        value={category()}
        onChange={(value) => props.session.setCategory(value)}
      />
    </header>
  );
}

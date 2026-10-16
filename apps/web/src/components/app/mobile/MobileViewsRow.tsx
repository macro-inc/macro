import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useMobileSearchCategory } from '@app/features/command/mobile/use-mobile-search-category';
import type { EntitySearchCategory } from '@app/features/command/queries/entity-search';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableProjects } from '@core/constant/featureFlags';
import { FloatRegion } from './float-regions/FloatRegion';
import { type PillTabItem, PillTabs } from './PillTabs';

const CATEGORIES: PillTabItem<EntitySearchCategory>[] = [
  { value: 'all', label: 'All' },
  { value: 'email', label: 'Email' },
  { value: 'chats', label: 'Agents' },
  { value: 'documents', label: 'Files' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'projects', label: 'Projects' },
  { value: 'channels', label: 'Channels' },
  { value: 'dms', label: 'People' },
];

/** Search categories filter entities directly without navigating between views. */
export function MobileViewsRow() {
  const projects = useFeatureFlag(enableProjects);
  const category = useMobileSearchCategory();
  return (
    <FloatRegion region="accessory" priority={100} active={SearchState.isOpen}>
      <PillTabs
        scrollable
        contentClass="px-(--mobile-chrome-gutter)"
        items={CATEGORIES.filter(
          (item) => item.value !== 'projects' || projects().enabled
        )}
        value={category()}
        onChange={SearchState.setCategory}
      />
    </FloatRegion>
  );
}

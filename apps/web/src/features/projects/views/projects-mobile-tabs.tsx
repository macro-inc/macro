import { t } from '@app/lib/i18n';
import { PillTabs } from '@components/app/mobile/PillTabs';
import type { JSX } from 'solid-js';
import { useProjectSavedViews } from '../context/project-saved-views-context';
import { ProjectSavedViewsPicker } from './project-saved-views';
import { PROJECT_VIEW_OPTIONS } from './project-view-options';

/** Keep project navigation in the same filter, saved-view, tabs order as other views. */
export function ProjectsMobileTabs(props: { filters: JSX.Element }) {
  const views = useProjectSavedViews();
  if (!views) return <>{props.filters}</>;
  return (
    <nav
      aria-label={t('viewMenus.projectViews')}
      class="flex h-10 min-w-0 flex-1"
    >
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={
          <>
            {props.filters}
            <ProjectSavedViewsPicker />
          </>
        }
        items={PROJECT_VIEW_OPTIONS}
        value={
          views.selectedId() || views.creating() ? undefined : views.scope()
        }
        onChange={views.selectScope}
      />
    </nav>
  );
}

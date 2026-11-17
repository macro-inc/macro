import { t } from '@app/lib/i18n';
import { Tabs } from '@ui';
import { type JSX, Show } from 'solid-js';
import { useProjectSavedViews } from '../context/project-saved-views-context';
import { ProjectSavedViewsPicker } from './project-saved-views';
import { PROJECT_VIEW_OPTIONS } from './project-view-options';

export function ProjectsDesktopTabs(props: {
  filters: JSX.Element;
  fallback: JSX.Element;
}) {
  const views = useProjectSavedViews();
  return (
    <div class="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      {props.filters}
      <Show when={views} fallback={props.fallback}>
        {(views) => (
          <>
            <ProjectSavedViewsPicker />
            <Tabs
              aria-label={t('viewMenus.projectViews')}
              class="shrink-0"
              options={PROJECT_VIEW_OPTIONS}
              value={
                views().selectedId() || views().creating()
                  ? undefined
                  : views().scope()
              }
              onChange={views().selectScope}
            />
          </>
        )}
      </Show>
    </div>
  );
}

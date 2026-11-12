import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import { For, getOwner, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SavedViewPicker } from '../../saved-views/components/saved-view-picker';
import { TAB_ICONS } from '../../tasks-view/components/task-view-icons';
import { useProjectSavedViews } from '../context/project-saved-views-context';
import { ProjectSavedViewRows } from './project-saved-views';

const SCOPES = [
  {
    id: 'assigned-to-me',
    label: 'My projects',
    icon: TAB_ICONS['my-projects'],
  },
  { id: 'all', label: 'All projects', icon: TAB_ICONS.projects },
  {
    id: 'created-by-me',
    label: 'Created by me',
    icon: TAB_ICONS['created-projects'],
  },
] as const;

/** The Projects phone view keeps its own filters and saved-view navigation. */
export function ProjectsMobileTabs(props: { filters: JSX.Element }) {
  const views = useProjectSavedViews();
  const owner = getOwner();
  if (!views) return <>{props.filters}</>;
  const label = () => {
    const view = views.draft.view();
    if (view.kind === 'saved') return view.record.name;
    if (view.kind === 'new') return 'New view';
    return (
      SCOPES.find((scope) => scope.id === views.scope())?.label ?? 'Projects'
    );
  };
  return (
    <div class="flex h-10 min-w-0 items-center justify-between gap-2">
      <SavedViewPicker
        title="Projects"
        label={label()}
        icon={
          views.draft.view().kind === 'saved' ||
          views.draft.view().kind === 'new' ? (
            <BookmarkIcon class="size-4 shrink-0" />
          ) : (
            <Dynamic
              component={
                SCOPES.find((scope) => scope.id === views.scope())?.icon ??
                TAB_ICONS['my-projects']
              }
              class="size-4 shrink-0"
            />
          )
        }
        active={false}
        scopeKey={views.viewerId()}
      >
        {(onAction) => (
          <>
            <For each={SCOPES}>
              {(scope) => (
                <MobileDrawer.Item
                  aria-current={
                    !views.selectedId() && views.scope() === scope.id
                      ? 'page'
                      : undefined
                  }
                  onClick={() => onAction(() => views.selectScope(scope.id))}
                >
                  {scope.label}
                </MobileDrawer.Item>
              )}
            </For>
            <div class="my-2 border-t border-edge-muted" />
            <ProjectSavedViewRows onAction={onAction} dialogOwner={owner} />
            <Show when={views.list.items()?.length}>
              <MobileDrawer.Item onClick={() => onAction(views.start)}>
                Create view
              </MobileDrawer.Item>
            </Show>
          </>
        )}
      </SavedViewPicker>
      {props.filters}
    </div>
  );
}

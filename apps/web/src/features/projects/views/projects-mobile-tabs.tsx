import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { For, getOwner, type JSX, Show } from 'solid-js';
import { SavedViewPicker } from '../../saved-views/components/saved-view-picker';
import { useProjectSavedViews } from '../context/project-saved-views-context';
import { ProjectSavedViewRows } from './project-saved-views';

const SCOPES = [
  { id: 'assigned-to-me', label: 'Assigned to me' },
  { id: 'all', label: 'All projects' },
  { id: 'created-by-me', label: 'Created by me' },
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
    <div class="flex h-10 min-w-0 items-center gap-2">
      {props.filters}
      <SavedViewPicker
        title="Projects"
        label={label()}
        active={Boolean(views.selectedId())}
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
    </div>
  );
}

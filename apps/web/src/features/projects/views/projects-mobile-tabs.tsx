import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import CheckIcon from '@icon/system/regular/check.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
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
  const [attachCreateHotkeys] = useHotkeyDOMScope(
    'create-project-view-mobile',
    true
  );
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
        hideTitle
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
            <MobileDrawer.Section class="mx-0">
              <For each={SCOPES}>
                {(scope) => (
                  <MobileDrawer.Item
                    aria-current={
                      !views.selectedId() && views.scope() === scope.id
                        ? 'page'
                        : undefined
                    }
                    class="h-12 gap-3 text-base aria-[current=page]:bg-accent/15 aria-[current=page]:text-accent"
                    onClick={() => onAction(() => views.selectScope(scope.id))}
                  >
                    <Dynamic component={scope.icon} class="size-5 shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{scope.label}</span>
                    <Show
                      when={!views.selectedId() && views.scope() === scope.id}
                    >
                      <CheckIcon class="size-5 shrink-0" />
                    </Show>
                  </MobileDrawer.Item>
                )}
              </For>
            </MobileDrawer.Section>
            <div class="px-3 pt-4 pb-2 text-sm text-ink-muted">Saved views</div>
            <ProjectSavedViewRows
              mobile
              onAction={onAction}
              dialogOwner={owner}
            />
            <MobileDrawer.Item
              ref={attachCreateHotkeys}
              class="mt-4 h-12 justify-center rounded-3xl bg-ink/6 text-base"
              onClick={() => onAction(views.start)}
            >
              <PlusIcon class="size-5" />
              New view
            </MobileDrawer.Item>
          </>
        )}
      </SavedViewPicker>
      {props.filters}
    </div>
  );
}

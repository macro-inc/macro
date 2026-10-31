import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { PillButton, PillTabs } from '@components/app/mobile/PillTabs';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { BUILT_IN_TASK_TABS, PROJECT_TABS } from '../constants';
import { isProjectTab } from '../core/task-navigation';
import { useTasksView } from '../tasks-view-context';
import { TaskSavedViewsPicker } from '../views/task-saved-views';
import { TasksFilterDrawer } from './TasksFilterDrawer';

function ProjectsPicker() {
  const { state, setTab } = useTasksView();
  const [open, setOpen] = createSignal(false);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const active = () => !state.savedViewActive && isProjectTab(state.tab);
  const label = () => {
    if (!active()) return t('viewMenus.projects');
    if (state.tab === 'created-projects')
      return t('viewMenus.projectsCreatedByMe');
    return (
      PROJECT_TABS.find((tab) => tab.id === state.tab)?.label ??
      t('viewMenus.projects')
    );
  };

  return (
    <MobileDrawer
      open={open()}
      onOpenChange={setOpen}
      restoreFocus
      finalFocusEl={trigger()}
    >
      <MobileDrawer.Trigger
        ref={setTrigger}
        as={PillButton}
        active={active()}
        aria-label={t('viewMenus.projectViews')}
        class="flex max-w-64 items-center gap-1.5"
      >
        <span class="truncate">{label()}</span>
        <CaretDownIcon class="size-3.5 shrink-0" />
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content>
          <MobileDrawer.Handle />
          <MobileDrawer.Title class="px-6 pb-3 text-base font-medium">
            {t('viewMenus.projects')}
          </MobileDrawer.Title>
          <MobileDrawer.ScrollBody class="px-3">
            <For each={PROJECT_TABS}>
              {(tab) => (
                <MobileDrawer.Close
                  as={MobileDrawer.Item}
                  aria-label={
                    tab.id === 'created-projects'
                      ? t('viewMenus.projectsCreatedByMe')
                      : tab.label
                  }
                  aria-current={
                    active() && state.tab === tab.id ? 'page' : undefined
                  }
                  class={
                    active() && state.tab !== tab.id
                      ? 'text-ink-extra-muted'
                      : undefined
                  }
                  onClick={() => setTab(tab.id)}
                >
                  {tab.label}
                </MobileDrawer.Close>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

export function TasksMobileTabs(props: { leading?: JSX.Element }) {
  const { state, setTab, projectsEnabled } = useTasksView();

  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={
          <>
            {props.leading ?? (
              <Show when={!isProjectTab(state.tab)}>
                <TasksFilterDrawer />
              </Show>
            )}
            <TaskSavedViewsPicker />
          </>
        }
        trailing={
          <Show when={projectsEnabled()}>
            <ProjectsPicker />
          </Show>
        }
        items={BUILT_IN_TASK_TABS.map((tab) => ({
          value: tab.id,
          label: tab.label,
        }))}
        value={state.savedViewActive ? undefined : state.tab}
        onChange={setTab}
      />
    </div>
  );
}

import { useViewControlHotkeys } from '@app/components/view-shell';
import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  SplitHeaderScope,
  useSplitHeaderScope,
} from '@components/app/SplitHeaderScope';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { openInNewTab } from '@components/app/tab-layout/open-in-new-tab';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import { enableRoutineStarterTemplates } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show, Suspense } from 'solid-js';
import { useRoutinesDiscover } from '../routine-suggestions/routine-suggestions';
import { getErrorMessage } from './core/routine-draft';
import {
  featuredTemplates,
  newRoutineDraft,
  type RoutineTemplate,
} from './core/routine-templates';
import { useRoutineCatalog } from './queries/catalog';
import { createRoutineListSource } from './queries/routine-sources';
import { RoutineDetail } from './routine-detail';
import { startRoutineDraft } from './routine-draft-start';
import { routineContent, routineIdFromContent } from './routine-navigation';
import { RoutineNew } from './routine-new';
import { useRoutineRowMenuActions } from './routine-row-menu-actions';
import { MobileRoutinesListHeader } from './views/mobile/routines-list-header';
import { RoutinesListView } from './views/routines-list';

function RoutinesContent() {
  const userId = useUserId();
  const layout = useSplitLayout();
  const panel = useSplitPanelOrThrow();
  const selectedId = () => routineIdFromContent(panel.handle.content());
  const open = (id?: string) =>
    layout.openWithSplit(routineContent(id), {
      handle: panel.handle,
      activate: true,
      search: {},
    });
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !selectedId(),
    search: {
      description: 'Search routines',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });
  const source = createRoutineListSource((error) =>
    toast.alert('Could not update routine', { subtext: getErrorMessage(error) })
  );
  const menu = useRoutineRowMenuActions(source, {
    open: (id) => open(id),
    openInNewSplit: (id) =>
      layout.openWithSplit(routineContent(id), {
        preferNewSplit: true,
        activate: true,
        search: {},
      }),
    openInNewTab: (id) => openInNewTab(() => open(id)),
  });
  const starterTemplates = useFeatureFlag(enableRoutineStarterTemplates);
  const hasPaidAccess = useHasPaidAccess();
  const catalog = useRoutineCatalog();
  const discover = useRoutinesDiscover();
  /** New routine: describe it, pick a template, or start fresh. */
  function create() {
    layout.popoverSplit({
      type: 'component',
      id: 'routine-compose',
      params: { onStart: () => open('new') },
    });
  }
  /** A template card skips New routine and opens its page already started. */
  function startFrom(template: RoutineTemplate) {
    startRoutineDraft(
      newRoutineDraft(template, {
        defaultModel: defaultModelForPlan(hasPaidAccess()),
        codeSteps: true,
      })
    );
    open('new');
  }
  return (
    <Show
      when={selectedId()}
      keyed
      fallback={
        <RoutinesListView
          mobileHeader={(focusSearch) => (
            <MobileRoutinesListHeader
              onBack={() =>
                panel.handle.canGoBack()
                  ? panel.handle.goBack()
                  : openAgentsPage(layout, 'new')
              }
              onSearch={focusSearch}
              onCreate={create}
            />
          )}
          source={source}
          userId={userId}
          registerSearchFocus={(focus) => (focusSearch = focus)}
          onCreate={() => create()}
          onOpen={(id) => open(id)}
          templates={
            starterTemplates().enabled ? featuredTemplates(catalog(), true) : []
          }
          onTemplate={startFrom}
          discover={discover()}
          menu={menu}
        />
      }
    >
      {(id) => (
        <Show
          when={id !== 'new'}
          fallback={
            <RoutineNew
              onCreated={(id) =>
                layout.openWithSplit(routineContent(id), {
                  handle: panel.handle,
                  activate: true,
                  search: {},
                  mergeHistory: isTouchDevice(),
                })
              }
              onCancel={() =>
                isTouchDevice() && panel.handle.canGoBack()
                  ? panel.handle.goBack()
                  : open()
              }
            />
          }
        >
          <RoutineDetail
            scheduleId={id}
            onBack={() =>
              isTouchDevice() && panel.handle.canGoBack()
                ? panel.handle.goBack()
                : open()
            }
            onOpen={(id) => open(id)}
          />
        </Show>
      )}
    </Show>
  );
}

function RoutinesTopBar() {
  const scope = useSplitHeaderScope();
  return (
    <Show when={scope}>
      <SplitHeaderScope.TopBar />
    </Show>
  );
}

export function RoutinesPage() {
  return (
    <SplitHeaderScope.Root when={isTouchDevice()}>
      <RoutinesTopBar />
      <Suspense
        fallback={
          <div class="p-6 text-sm text-ink-muted">Loading routines…</div>
        }
      >
        <RoutinesContent />
      </Suspense>
    </SplitHeaderScope.Root>
  );
}

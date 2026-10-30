import { useViewControlHotkeys } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { toast } from '@core/component/Toast/Toast';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { Show, Suspense } from 'solid-js';
import { getErrorMessage } from './core/routine-draft';
import {
  featuredTemplates,
  newRoutineDraft,
  type RoutineTemplate,
} from './core/routine-templates';
import { saveRoutineComposerDraft } from './draft-storage';
import { createRoutineListSource } from './queries/routine-sources';
import { RoutineDetail } from './routine-detail';
import { routineContent, routineIdFromContent } from './routine-navigation';
import { RoutineNew } from './routine-new';
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
  const decisions = useFeatureFlag(enableRoutineConditions);
  const hasPaidAccess = useHasPaidAccess();
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
    saveRoutineComposerDraft(
      newRoutineDraft(template, {
        decisions: decisions().enabled,
        defaultModel: defaultModelForPlan(hasPaidAccess()),
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
          source={source}
          userId={userId}
          registerSearchFocus={(focus) => (focusSearch = focus)}
          onCreate={() => create()}
          onOpen={(id) => open(id)}
          templates={featuredTemplates(decisions().enabled)}
          onTemplate={startFrom}
        />
      }
    >
      {(id) => (
        <Show
          when={id !== 'new'}
          fallback={
            <RoutineNew onCreated={(id) => open(id)} onCancel={() => open()} />
          }
        >
          <RoutineDetail
            scheduleId={id}
            onBack={() => open()}
            onOpen={(id) => open(id)}
          />
        </Show>
      )}
    </Show>
  );
}
export function RoutinesPage() {
  return (
    <Suspense
      fallback={<div class="p-6 text-sm text-ink-muted">Loading routines…</div>}
    >
      <RoutinesContent />
    </Suspense>
  );
}

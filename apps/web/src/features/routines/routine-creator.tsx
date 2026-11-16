import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import {
  enableRoutineBackgroundDrafts,
  enableRoutineCodeSteps,
  enableRoutineConditions,
  enableRoutineStarterTemplates,
} from '@core/constant/featureFlags';
import { type ComponentProps, Show } from 'solid-js';
import { useRoutineCatalog } from './queries/catalog';
import { RoutineAiComposer } from './routine-ai-composer';
import { RoutineBackgroundDrafts } from './routine-background-drafts';
import { startRoutineDraft } from './routine-draft-start';
import { RoutineCreatorView } from './views/routine-creator';

/**
 * Production composition for New routine in the shared creation popover. A
 * choice closes it and opens the new routine's page with that draft.
 */
export function RoutineCreator(
  props: {
    /** Opens the new routine's page; by default in the Agents workspace. */
    onStart?: () => void;
  } = {}
) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const hasPaidAccess = useHasPaidAccess();
  const decisions = useFeatureFlag(enableRoutineConditions);
  const templates = useFeatureFlag(enableRoutineStarterTemplates);
  const defaultModel = () => defaultModelForPlan(hasPaidAccess());
  const codeSteps = useFeatureFlag(enableRoutineCodeSteps);
  const catalog = useRoutineCatalog();
  const background = useFeatureFlag(enableRoutineBackgroundDrafts);
  // The page reads its first draft from the unsent-draft store.
  const open = () => {
    panel.handle.close();
    if (props.onStart) props.onStart();
    else openAgentsPage(layout, 'routines', { routineId: 'new' });
  };
  const view = (
    slots: Pick<
      ComponentProps<typeof RoutineCreatorView>,
      'renderComposer' | 'drafting'
    >
  ) => (
    <RoutineCreatorView
      defaultModel={defaultModel()}
      decisionsEnabled={decisions().enabled}
      templatesEnabled={templates().enabled}
      catalog={catalog()}
      codeSteps={codeSteps().enabled}
      renderComposer={slots.renderComposer}
      drafting={slots.drafting}
      onClose={() => panel.handle.close()}
      onStart={(draft) => {
        startRoutineDraft(draft);
        open();
      }}
    />
  );
  return (
    <Show
      when={background().enabled}
      fallback={view({
        renderComposer: (apply, current, initialDescription) => (
          <RoutineAiComposer
            apply={apply}
            current={current}
            initialDescription={initialDescription}
            defaultModel={defaultModel()}
            decisionsEnabled={decisions().enabled}
          />
        ),
      })}
    >
      <RoutineBackgroundDrafts
        defaultModel={defaultModel()}
        decisionsEnabled={decisions().enabled}
        open={open}
      >
        {(slots) =>
          view({
            renderComposer: () => slots.describe(),
            get drafting() {
              return slots.drafting;
            },
          })
        }
      </RoutineBackgroundDrafts>
    </Show>
  );
}

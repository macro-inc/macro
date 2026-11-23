import { beginInteraction } from '@app/observability/flow';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMemo, mergeProps, Show } from 'solid-js';
import { createRecentAgentSelections } from '../block-agent/context/recent-agent-selections';
import { createRecentModelSelections } from '../block-agent/context/recent-model-selections';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from './components/unified-model-selector/root';
import { MobileModelSelector } from './views/mobile/model-selector';
import { DesktopModelSelector } from './views/model-selector/desktop-model-selector';

/** Hosts still own preferences and mutations; this boundary owns selection telemetry. */
export function UnifiedModelSelector(props: {
  state: UnifiedModelSelectorState;
}) {
  const userId = useUserId();
  const recentModels = createMemo(() => createRecentModelSelections(userId()));
  const recentAgents = createMemo(() => createRecentAgentSelections(userId()));
  const track = (
    action: string,
    attributes: Record<string, string>,
    run: () => void
  ) => {
    const interaction = beginInteraction(action, { attributes });
    try {
      run();
    } finally {
      interaction.end();
    }
  };
  const state = mergeProps(() => props.state, {
    get recentModelIds() {
      return recentModels().ids();
    },
    get recentAgentIds() {
      return recentAgents().ids();
    },
    onModel: (id: string) =>
      track('agents.model_selector.pick', { 'model.id': id }, () => {
        props.state.onModel(id);
        recentModels().remember(id);
      }),
    onSuggestedModel: (id: string) =>
      track('agents.model_selector.pick', { 'model.id': id }, () => {
        (props.state.onSuggestedModel ?? props.state.onModel)(id);
        recentModels().remember(id);
      }),
    onAgent: (
      agent: Parameters<NonNullable<UnifiedModelSelectorState['onAgent']>>[0]
    ) =>
      track('agents.model_selector.agent', { 'agent.id': agent.id }, () => {
        props.state.onAgent?.(agent);
        recentAgents().remember(agent.id);
      }),
    onEffort: (choice: Parameters<UnifiedModelSelectorState['onEffort']>[0]) =>
      track(
        'agents.model_selector.effort',
        {
          'model.id': props.state.model ?? '',
          'config.id': choice.configId,
          'config.value': choice.value,
        },
        () => props.state.onEffort(choice)
      ),
    onSpeed: (value: Parameters<UnifiedModelSelectorState['onSpeed']>[0]) =>
      track(
        'agents.model_selector.speed',
        { 'model.id': props.state.model ?? '', 'speed.value': value },
        () => props.state.onSpeed(value)
      ),
    onOpenChange: (open: boolean) => {
      if (!open) {
        props.state.onOpenChange?.(false);
        return;
      }
      track(
        'agents.model_selector.open',
        { 'model.id': props.state.model ?? '' },
        () => {
          recentModels().refresh();
          props.state.onOpenChange?.(true);
        }
      );
    },
  });
  return (
    <UnifiedModelSelectorRoot state={state}>
      <Show when={isTouchDevice()} fallback={<DesktopModelSelector />}>
        <MobileModelSelector />
      </Show>
    </UnifiedModelSelectorRoot>
  );
}

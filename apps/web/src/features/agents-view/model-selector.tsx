import { startUiOperation } from '@app/observability/ui-operation';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
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
    run: () => unknown,
    applied?: () => void
  ) => {
    const account = userId();
    const operation = startUiOperation(action, { attributes });
    const finish = (result: unknown) => {
      if (userId() !== account) {
        operation.cancel();
        return;
      }
      if (result === false) {
        operation.span.error('Selector action was not applied');
        operation.finish('error');
        return;
      }
      applied?.();
      operation.afterPaint();
    };
    const fail = (error: unknown) => {
      operation.span.error(error);
      operation.finish('error');
    };
    try {
      const result = operation.run(run);
      if (result instanceof Promise) {
        const settle = async () => {
          try {
            finish(await result);
          } catch (error) {
            fail(error);
          }
        };
        fireAndForget(settle(), 'agents.model-selector');
      } else finish(result);
    } catch (error) {
      fail(error);
      throw error;
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
      track(
        'agents.model_selector.pick',
        { 'model.id': id },
        () => props.state.onModel(id),
        () => recentModels().remember(id)
      ),
    onSuggestedModel: (id: string) =>
      track(
        'agents.model_selector.pick',
        { 'model.id': id },
        () => (props.state.onSuggestedModel ?? props.state.onModel)(id),
        () => recentModels().remember(id)
      ),
    onAgent: (
      agent: Parameters<NonNullable<UnifiedModelSelectorState['onAgent']>>[0]
    ) =>
      track(
        'agents.model_selector.agent',
        { 'agent.id': agent.id },
        () => (props.state.onAgent ? props.state.onAgent(agent) : false),
        () => recentAgents().remember(agent.id)
      ),
    get onKeepModel() {
      const keepModel = props.state.onKeepModel;
      if (!keepModel) return undefined;
      return (keep: boolean) =>
        track(
          'agents.model_selector.keep',
          {
            'agent.id': props.state.agent?.id ?? '',
            'model.id': props.state.model ?? '',
            kept: String(keep),
          },
          () => keepModel(keep)
        );
    },
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

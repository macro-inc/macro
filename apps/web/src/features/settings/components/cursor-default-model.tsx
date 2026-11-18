import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import { useAgentModelsQuery } from '@queries/agents/models';
import {
  useCursorApiKeyStatusQuery,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { EffortSelector } from '../../block-agent/component/EffortSelector';
import {
  type EffortChoice,
  effortConfigOption,
} from '../../block-agent/state/session-config';

/**
 * The model and reasoning effort new Cursor sessions start on. Saves on
 * change; renders loading, error, and unsupported states in place of the
 * picker. The effort stops are the selected model's own, so a saved effort the
 * model no longer offers shows the model's default instead.
 */
export function CursorDefaultModel(props: { triggerClass?: string }) {
  const cursorStatus = useCursorApiKeyStatusQuery();
  const registered = () =>
    cursorStatus.isSuccess ? cursorStatus.data.registered : false;
  const cursorModels = useAgentModelsQuery(
    () => ({ harness: 'cursor' }),
    registered
  );
  const setDefaultModel = useSetCursorDefaultModel();
  const modelData = () =>
    cursorModels.isSuccess ? cursorModels.data : undefined;
  const modelOptions = () => {
    const data = modelData();
    if (data?.status !== 'available') return [];
    const saved = cursorStatus.data?.defaultModelId;
    if (!saved || data.models.some((model) => model.id === saved)) {
      return data.models;
    }
    return [
      ...data.models,
      {
        id: saved,
        name: `${saved} (saved, unavailable)`,
        description: undefined,
        group: undefined,
      },
    ];
  };
  const catalogOptions = () =>
    modelOptions().map((model) => ({
      id: model.id,
      label: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  const selectedModelId = () =>
    (cursorStatus.isSuccess ? cursorStatus.data.defaultModelId : null) ??
    modelData()?.currentModel ??
    modelOptions()[0]?.id ??
    null;

  const capabilities = useAgentCapabilitiesQuery(() => {
    const model = selectedModelId();
    if (!registered() || modelData()?.status !== 'available' || !model) return;
    return { harness: 'cursor', model } as const;
  });
  const effort = () =>
    effortConfigOption(
      capabilities.isPending ? [] : (capabilities.data?.configOptions ?? [])
    );
  const selectedEffort = () => {
    const config = effort();
    const saved = cursorStatus.isSuccess
      ? cursorStatus.data.defaultEffort
      : null;
    if (saved && config?.options.some((option) => option.value === saved)) {
      return saved;
    }
    return config?.currentValue;
  };

  // A model saved alone clears the effort, which belonged to the old model.
  const changeModel = async (modelId: string) => {
    try {
      await setDefaultModel.mutateAsync({ modelId });
      toast.success('Default model updated');
    } catch (error) {
      toast.failure(
        (error instanceof ThrownResultError && error.message) ||
          'Failed to set your default model'
      );
    }
  };

  const changeEffort = async (choice: EffortChoice) => {
    const modelId = selectedModelId();
    if (!modelId) return;
    try {
      await setDefaultModel.mutateAsync({ modelId, effort: choice.value });
      toast.success('Default effort updated');
    } catch (error) {
      toast.failure(
        (error instanceof ThrownResultError && error.message) ||
          'Failed to set your default effort'
      );
    }
  };

  return (
    <Show
      when={!cursorModels.isPending}
      fallback={
        <ModelCatalogPicker
          value={null}
          options={[]}
          placeholder="Loading models…"
          onSelect={(id) => fireAndForget(changeModel(id), 'cursor-connect')}
          ariaLabel="Default model"
          triggerClass={
            props.triggerClass ??
            'h-9 w-full justify-between text-base [&>span]:flex-1'
          }
          pending
        />
      }
    >
      <Show
        when={!cursorModels.isError}
        fallback={
          <div class="flex items-center gap-2">
            <p class="text-xs text-negative">Could not load Cursor models.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                fireAndForget(cursorModels.refetch(), 'cursor-connect')
              }
            >
              Retry
            </Button>
          </div>
        }
      >
        <Show
          when={modelData()?.status === 'available'}
          fallback={
            <p class="text-xs text-ink-muted">
              Cursor does not support model selection.
            </p>
          }
        >
          <div class="flex w-full min-w-0 items-center gap-1">
            <div class="min-w-0 flex-1">
              <ModelCatalogPicker
                value={selectedModelId()}
                options={catalogOptions()}
                onSelect={(id) =>
                  fireAndForget(changeModel(id), 'cursor-connect')
                }
                disabled={setDefaultModel.isPending}
                ariaLabel="Default model"
                triggerClass={
                  props.triggerClass ??
                  'h-9 w-full justify-between text-base [&>span]:flex-1'
                }
                placement="bottom-start"
              />
            </div>
            <EffortSelector
              config={effort()}
              value={selectedEffort()}
              disabled={setDefaultModel.isPending}
              onChange={(choice) =>
                fireAndForget(changeEffort(choice), 'cursor-connect')
              }
            />
          </div>
        </Show>
      </Show>
    </Show>
  );
}

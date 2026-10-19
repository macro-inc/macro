import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import { useAgentModelsQuery } from '@queries/agents/models';
import {
  useCursorApiKeyStatusQuery,
  useSetCursorDefaultModel,
} from '@queries/auth/cursor-api-key';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { SettingsSelect } from './settings-select';

/**
 * The model new Cursor sessions start on. Saves on change; renders loading,
 * error, and unsupported states in place of the picker.
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

  const changeModel = async (modelId: string) => {
    try {
      await setDefaultModel.mutateAsync(modelId);
      toast.success('Default model updated');
    } catch (error) {
      toast.failure(
        (error instanceof ThrownResultError && error.message) ||
          'Failed to set your default model'
      );
    }
  };

  return (
    <Show
      when={!cursorModels.isPending}
      fallback={
        <SettingsSelect
          label="Default model"
          options={[]}
          placeholder="Loading models…"
          triggerClass={props.triggerClass}
          onChange={(id) => fireAndForget(changeModel(id), 'cursor-connect')}
          disabled
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
              variant="outline"
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
          <Show
            when={isLargeModelCatalog(catalogOptions())}
            fallback={
              <SettingsSelect
                label="Default model"
                options={modelOptions()}
                value={selectedModelId()}
                triggerClass={props.triggerClass}
                disabled={setDefaultModel.isPending}
                onChange={(id) =>
                  fireAndForget(changeModel(id), 'cursor-connect')
                }
              />
            }
          >
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
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

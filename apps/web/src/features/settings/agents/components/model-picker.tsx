import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { isLargeModelCatalog } from '@core/component/AI/component/input/modelCatalog';
import { Button } from '@ui';
import { For, Match, Show, Switch } from 'solid-js';
import type { AgentModel, ModelCatalog } from '../core/types';

export function AgentModelPicker(props: {
  catalog: ModelCatalog;
  models: AgentModel[];
  value: string;
  runtimeName: string;
  onChange: (id: string) => void;
  onRetry: () => void;
}) {
  const options = () =>
    props.models.map((model) => ({
      id: model.id,
      label: model.name,
      description: model.description ?? undefined,
      group: model.group ?? undefined,
    }));
  return (
    <div class="flex flex-col gap-2">
      <span class="text-xs font-medium text-ink">Default model</span>
      <Switch>
        <Match when={props.catalog.state === 'loading'}>
          <select
            aria-label="Default model"
            class="settings-input w-full"
            disabled
          >
            <option>Loading models…</option>
          </select>
        </Match>
        <Match when={props.catalog.state === 'error'}>
          <div class="flex items-center justify-between gap-2 rounded-lg border border-edge-muted p-3">
            <p role="status" class="text-xs text-ink-muted">
              Could not load models for {props.runtimeName}.
            </p>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Retry models for ${props.runtimeName}`}
              onClick={props.onRetry}
            >
              Retry
            </Button>
          </div>
          <Show when={props.value}>
            <p class="text-xs text-ink-muted">
              Your saved model ({props.value}) will be kept.
            </p>
          </Show>
        </Match>
        <Match when={props.catalog.state === 'unsupported'}>
          <p class="text-xs text-ink-muted">
            This runtime chooses its own model.
          </p>
        </Match>
        <Match when={props.catalog.state === 'unavailable'}>
          <p class="text-xs text-ink-muted">
            Choose a connected runtime to see its models.
          </p>
        </Match>
        <Match when={props.catalog.state === 'available'}>
          <Show
            when={props.models.length}
            fallback={
              <p class="text-xs text-ink-muted">
                This runtime did not return any models. Try reconnecting it in
                Runtimes.
              </p>
            }
          >
            <Show
              when={isLargeModelCatalog(options())}
              fallback={
                <select
                  aria-label="Default model"
                  class="settings-input w-full"
                  value={props.value}
                  onChange={(event) =>
                    props.onChange(event.currentTarget.value)
                  }
                >
                  <For each={props.models}>
                    {(model) => <option value={model.id}>{model.name}</option>}
                  </For>
                </select>
              }
            >
              <ModelCatalogPicker
                value={props.value}
                options={options()}
                onSelect={props.onChange}
                ariaLabel="Default model"
                triggerClass="w-full justify-between"
                contentClass="overflow-hidden"
              />
            </Show>
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

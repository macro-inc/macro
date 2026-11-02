import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import { fireAndForget } from '@core/util/fireAndForget';
import type { useAgentModelsQueries } from '@queries/agents/models';
import { Button } from '@ui';
import type { ComponentProps } from 'solid-js';
import { Show } from 'solid-js';

type ModelQuery = ReturnType<typeof useAgentModelsQueries>[number];

/**
 * The default-model field for one runtime: loading, retryable error,
 * unsupported, and empty states, then the searchable catalog picker.
 */
export function AgentModelPicker(props: {
  /** The runtime's model query; absent when it has no model discovery. */
  query?: ModelQuery;
  runtimeName?: string;
  available: boolean;
  options: ComponentProps<typeof ModelCatalogPicker>['options'];
  value: string;
  onChange: (id: string) => void;
}) {
  const runtimeName = () => props.runtimeName ?? 'this runtime';
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <span class="text-xs font-medium text-ink-muted">Model</span>
      <Show
        when={props.query}
        fallback={
          <p class="settings-input text-ink-muted">
            Model discovery unavailable
          </p>
        }
        keyed
      >
        {(query) => (
          <Show
            when={!query.isPending}
            fallback={
              <ModelCatalogPicker
                value={null}
                options={[]}
                placeholder="Loading models…"
                onSelect={props.onChange}
                ariaLabel="Default model"
                triggerClass="w-full justify-between"
                pending
              />
            }
          >
            <Show
              when={!query.isError}
              fallback={
                <div class="flex items-center gap-2">
                  <p class="min-w-0 flex-1 text-xs text-negative">
                    Could not load models for {runtimeName()}.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={`Retry models for ${runtimeName()}`}
                    onClick={() =>
                      fireAndForget(query.refetch(), 'agent-settings')
                    }
                  >
                    Retry
                  </Button>
                </div>
              }
            >
              <Show
                when={props.available}
                fallback={
                  <p class="settings-input text-ink-muted">
                    Model selection is unsupported by this runtime.
                  </p>
                }
              >
                <Show
                  when={props.options.length > 0}
                  fallback={
                    <p class="settings-input text-ink-muted">
                      This runtime did not return any models.
                    </p>
                  }
                >
                  <ModelCatalogPicker
                    value={props.value}
                    options={props.options}
                    onSelect={props.onChange}
                    ariaLabel="Default model"
                    triggerClass="w-full justify-between"
                    contentClass="overflow-hidden"
                    placement="bottom-start"
                  />
                </Show>
              </Show>
            </Show>
          </Show>
        )}
      </Show>
    </div>
  );
}

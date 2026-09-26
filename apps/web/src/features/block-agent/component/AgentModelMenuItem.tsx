import {
  ModelRow,
  type ModelRowProps,
} from '@core/component/AI/component/input/ModelCatalogPicker';
import { ProviderIcon } from '@core/component/AI/component/ProviderIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import { useAgentCapabilitiesQuery } from '@queries/agents/capabilities';
import { Dropdown } from '@ui';
import { createSignal, For, Show, Suspense } from 'solid-js';
import {
  type EffortChoice,
  effortConfigOption,
  type SelectSessionConfigOption,
} from '../state/session-config';

/** Discover only the hovered model; a live session's current snapshot takes precedence. */
export function AgentModelMenuItem(
  props: ModelRowProps & {
    harness?: string;
    effort?: SelectSessionConfigOption;
    effortValue?: string;
    onSelectEffort: (effort: EffortChoice) => void;
  }
) {
  const discoverable = () =>
    ['cursor', 'in-memory', 'macro-inmem'].includes(props.harness ?? '');
  return (
    <Show
      when={discoverable() || props.effort}
      fallback={<ModelRow {...props} />}
    >
      <EffortModelSubmenu {...props} />
    </Show>
  );
}

function EffortModelSubmenu(
  props: ModelRowProps & {
    harness?: string;
    effort?: SelectSessionConfigOption;
    effortValue?: string;
    onSelectEffort: (effort: EffortChoice) => void;
  }
) {
  const [open, setOpen] = createSignal(false);
  const query = useAgentCapabilitiesQuery(() => {
    const harness =
      props.harness === 'macro-inmem' ? 'in-memory' : props.harness;
    return open() &&
      !props.effort &&
      (harness === 'cursor' || harness === 'in-memory')
      ? { harness, model: props.option.id }
      : undefined;
  });
  const effort = () =>
    props.effort ??
    (query.isSuccess
      ? effortConfigOption(query.data.configOptions)
      : undefined);
  return (
    <Dropdown.Sub open={open()} onOpenChange={setOpen} overlap>
      <Dropdown.SubTrigger
        disabled={props.disabled}
        class="h-8 gap-2"
        textValue={props.option.label}
        title={props.option.description ?? props.option.label}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            props.onSelect();
          }
        }}
        onClick={() => {
          if (!isTouchDevice()) props.onSelect();
        }}
      >
        <ProviderIcon model={props.option.id} class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate text-sm">
          {props.option.label}
        </span>
        <Show when={props.selected}>
          <Check class="size-3.5 shrink-0 text-accent" />
        </Show>
        <CaretRight class="size-3 shrink-0 text-ink-muted" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent
        aria-label={`Effort for ${props.option.label}`}
        class="w-48 max-w-[calc(100vw-1rem)] max-h-[var(--kb-popper-content-available-height)] overflow-y-auto overscroll-contain"
        onPointerDown={(event: PointerEvent) => event.stopPropagation()}
        onMouseDown={(event: MouseEvent) => event.stopPropagation()}
      >
        <Suspense>
          <Dropdown.Group>
            <Dropdown.Item closeOnSelect onSelect={props.onSelect}>
              Use {props.option.label}
            </Dropdown.Item>
            <Dropdown.GroupLabel>Reasoning effort</Dropdown.GroupLabel>
            <Show
              when={effort()}
              fallback={
                <div role="status" class="px-2 py-2 text-xs text-ink-muted">
                  {query.isFetching
                    ? 'Loading effort options…'
                    : query.isError
                      ? 'Effort options unavailable.'
                      : 'No effort options for this model.'}
                </div>
              }
            >
              {(config) => (
                <For each={config().options}>
                  {(option) => (
                    <Dropdown.Item
                      closeOnSelect
                      title={option.description ?? undefined}
                      onSelect={() => {
                        props.onSelectEffort({
                          configId: config().id,
                          value: option.value,
                          name: option.name,
                        });
                        props.onClose?.();
                      }}
                    >
                      <span class="flex-1">{option.name}</span>
                      <Show
                        when={
                          props.selected &&
                          option.value ===
                            (props.effortValue ?? config().currentValue)
                        }
                      >
                        <Check class="size-3.5 text-accent" />
                      </Show>
                    </Dropdown.Item>
                  )}
                </For>
              )}
            </Show>
          </Dropdown.Group>
        </Suspense>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

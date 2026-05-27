import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
  Model,
} from '@core/component/AI/constant';
import type { TModel } from '@core/component/AI/types';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg?component-solid';
import { Dropdown } from '@ui';
import type { Accessor } from 'solid-js';
import { For } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type ModelSelectorProps = {
  selectedModel?: TModel;
  availableModels?: Accessor<TModel[]>;
  onSelect: (model: TModel) => void;
};

export function ModelSelector(props: ModelSelectorProps) {
  const model = () => props.selectedModel ?? DEFAULT_MODEL;

  const setSelected = (selected: TModel) => {
    props.onSelect(selected);
  };

  return (
    <Dropdown>
      <Dropdown.Trigger variant="ghost">
        <Dynamic component={MODEL_PROVIDER_ICON[model()]} />
        {MODEL_PRETTYNAME[model()]}
        <CaretDown />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <For
            each={
              props.availableModels
                ? props.availableModels()
                : (Object.values(Model) as Model[])
            }
          >
            {(m) => (
              <Dropdown.Item onSelect={() => setSelected(m)}>
                <Dynamic
                  component={MODEL_PROVIDER_ICON[m]}
                  class="size-4 shrink-0"
                />
                <span class="flex-1 truncate">{MODEL_PRETTYNAME[m]}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

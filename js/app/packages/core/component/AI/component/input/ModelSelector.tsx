import { withAnalytics } from '@coparse/analytics';
import {
  DEFAULT_MODEL,
  MODEL_PRETTYNAME,
  MODEL_PROVIDER_ICON,
  Model,
} from '@core/component/AI/constant';
import type { TModel } from '@core/component/AI/types';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { TextButton } from '@core/component/TextButton';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { Accessor } from 'solid-js';
import { For } from 'solid-js';

export type ModelSelectorProps = {
  selectedModel?: TModel;
  availableModels?: Accessor<TModel[]>;
  onSelect: (model: TModel) => void;
};

export function ModelSelector(props: ModelSelectorProps) {
  const { track, TrackingEvents } = withAnalytics();

  const model = () => props.selectedModel ?? DEFAULT_MODEL;

  const setSelected = (selected: TModel) => {
    props.onSelect(selected);
    track(TrackingEvents.CHAT.MODEL.SELECT, { model: selected });
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) {
          track(TrackingEvents.CHAT.MODEL.OPEN);
        } else {
          track(TrackingEvents.CHAT.MODEL.CLOSE);
        }
      }}
    >
      <DropdownMenu.Trigger>
        <TextButton
          theme="clear"
          text={MODEL_PRETTYNAME[model()]}
          icon={MODEL_PROVIDER_ICON[model()]}
          showChevron
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenuContent>
          <For
            each={
              props.availableModels
                ? props.availableModels()
                : (Object.values(Model) as Model[])
            }
          >
            {(model) => (
              <MenuItem
                icon={MODEL_PROVIDER_ICON[model]}
                text={MODEL_PRETTYNAME[model]}
                onClick={() => {
                  setSelected(model);
                }}
              />
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

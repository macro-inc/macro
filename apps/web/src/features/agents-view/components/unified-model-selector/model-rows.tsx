import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import Check from '@icon/system/regular/check.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui';
import { cn } from '@ui/utils/classname';
import { Show } from 'solid-js';

/** Keyed rows retain focused DOM nodes when capabilities or selection update. */
export function ModelRows(props: {
  models: CatalogModelOption[];
  mobile?: boolean;
  selected?: string;
  disabled?: boolean;
  showLogos?: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <Key each={props.models} by="id">
      {(option) => (
        <Button
          variant="ghost"
          appearance="bare"
          data-model-choice
          class={cn(
            'flex w-full items-center text-left font-normal gap-2.5 px-2.5 py-2 rounded-lg not-touch:hover:bg-hover focus-visible:bg-active text-sm',
            props.mobile
              ? 'h-11 rounded-[22px] gap-3 px-3 py-2.5 text-base leading-[22px]'
              : 'min-h-9'
          )}
          disabled={props.disabled}
          onClick={() => props.onPick(option().id)}
        >
          <Show when={props.showLogos !== false}>
            <ModelIcon
              model={option().id}
              class={props.mobile ? 'size-[18px] shrink-0' : 'size-4 shrink-0'}
            />
          </Show>
          <span class="min-w-0 flex-1 truncate">{option().label}</span>
          <Show when={props.selected === option().id}>
            <Check
              class={
                props.mobile
                  ? 'size-[18px] text-accent'
                  : 'size-3.5 text-accent'
              }
            />
          </Show>
        </Button>
      )}
    </Key>
  );
}

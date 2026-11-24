import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import { ModelIcon } from '@core/component/AI/component/ProviderIcon';
import Check from '@icon/system/regular/check.svg';
import { Key } from '@solid-primitives/keyed';
import { Menu } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

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
        <Dynamic
          component={props.mobile ? MobileDrawer.Item : Menu.Item}
          data-model-choice
          aria-pressed={props.selected === option().id}
          disabled={props.disabled}
          onClick={() => props.onPick(option().id)}
        >
          <Show when={props.showLogos !== false}>
            <ModelIcon model={option().id} class="size-4 shrink-0" />
          </Show>
          <span class="min-w-0 flex-1 truncate">{option().label}</span>
          <Show when={props.selected === option().id}>
            <Check class="size-4 shrink-0" />
          </Show>
        </Dynamic>
      )}
    </Key>
  );
}

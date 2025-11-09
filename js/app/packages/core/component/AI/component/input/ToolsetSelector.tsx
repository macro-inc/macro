import { MenuItem } from '@core/component/Menu';
import { TextButton } from '@core/component/TextButton';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import type { ToolSet } from '@service-cognition/generated/schemas';
import { For, type Signal } from 'solid-js';

type ToolSetName = ToolSet['type'];
const DROPDOWN_OPTIONS: Record<ToolSetName, string> = {
  all: 'Agent',
  none: 'Ask',
};

export function ToolsetSelector(props: { toolset: Signal<ToolSet> }) {
  const [toolset, setToolset] = props.toolset;

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger>
        <TextButton
          theme="clear"
          onClick={() => {}}
          text={DROPDOWN_OPTIONS[toolset().type]}
          showChevron
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        {/*there's probabably a real way to do this, but if I don't z index then big chat dropdown broke*/}
        <DropdownMenu.Content class="z-100000">
          <For each={Object.entries(DROPDOWN_OPTIONS)}>
            {([k, v]) => (
              <MenuItem
                class="bg-panel"
                text={v}
                onClick={() => setToolset({ type: k as ToolSetName })}
              />
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}

import IconClipboard from '@phosphor-icons/core/regular/clipboard.svg?component-solid';
import IconDotsThreeVertical from '@phosphor/dots-three-vertical.svg';
import { deleteTheme, exportTheme } from '../utils/themeUtils';
import { setDarkModeTheme, setLightModeTheme, userThemes } from '../signals/themeSignals';
import { createMemo, Show } from 'solid-js';
import { Button, Dropdown } from '@ui';

interface ThemeCrudProps { themeId: string; }

export function ThemeCrud(props: ThemeCrudProps) {
  const isUserTheme = createMemo(() =>
    userThemes().some((t) => t.id === props.themeId)
  );

  const stop = (e: Event) => e.stopPropagation();

  return (
    <div
      class="flex shrink-0 items-center gap-0.5"
      onClick={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      <Button
        label="Copy To Clipboard"
        onPointerDown={() => exportTheme(props.themeId)}
        variant="ghost"
        size="icon-sm"
      >
        <IconClipboard />
      </Button>

      <Dropdown placement="bottom-end">
        <Dropdown.Trigger label="Theme options" variant="ghost" size="icon-sm">
          <IconDotsThreeVertical />
        </Dropdown.Trigger>
        <Dropdown.Content class="shadow-menu">
          <Dropdown.Group>
            <Dropdown.Item
              class="touch:min-h-10"
              onSelect={() => setDarkModeTheme(props.themeId)}
            >
              Set default dark theme
            </Dropdown.Item>
            <Dropdown.Item
              class="touch:min-h-10"
              onSelect={() => setLightModeTheme(props.themeId)}
            >
              Set default light theme
            </Dropdown.Item>
          </Dropdown.Group>
          {/* Separate group renders a divider (gap-px) above the destructive
              action; only user themes can be deleted. */}
          <Show when={isUserTheme()}>
            <Dropdown.Group>
              <Dropdown.Item
                class="text-failure touch:min-h-10"
                onSelect={() => deleteTheme(props.themeId)}
              >
                Delete
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}

export default ThemeCrud;

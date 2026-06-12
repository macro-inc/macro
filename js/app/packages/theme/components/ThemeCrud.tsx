import IconClipboard from '@phosphor-icons/core/regular/clipboard.svg?component-solid';
import IconTrash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { deleteTheme, exportTheme } from '../utils/themeUtils';
import { userThemes } from '../signals/themeSignals';
import { createMemo, Show } from 'solid-js';
import { Button } from '@ui';

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

      <Show when={isUserTheme()}>
        <Button
          onPointerDown={() => {
            deleteTheme(props.themeId);
          }}
          label="Delete Theme"
          variant="ghost"
          size="icon-sm"
        >
          <IconTrash />
        </Button>
      </Show>
    </div>
  );
}

export default ThemeCrud;

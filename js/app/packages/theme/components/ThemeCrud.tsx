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
      style="
        grid-auto-columns: min-content;
        background-color: var(--b0);
        grid-auto-flow: column;
        box-sizing: border-box;
        align-items: center;
        direction: rtl;
        padding: 0 12px;
        display: grid;
        height: 100%;
        gap: 4.5px;
      "
      onClick={stop}
      onPointerDown={stop}
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

import type { ColorBlock } from '@block-color/type/ColorBlock';
// import { validateColorBlockAsTheme } from '@block-color/util/validateTheme';
import { IconButton } from '@core/component/IconButton';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { Bar } from '@core/component/TopBar/Bar';
import { buildSimpleEntityUrl } from '@core/util/url';
import ClipboardIcon from '@icon/regular/clipboard.svg?component-solid';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { createCallback } from '@solid-primitives/rootless';
import type { Accessor } from 'solid-js';
import { createMemo, Show } from 'solid-js';

export default function TopBar(props: {
  colorBlock: Accessor<ColorBlock | undefined>;
  id: string;
  onGenerateRandom: () => void;
}) {
  const themeDetected = createMemo(() => {
    const cb = props.colorBlock();
    if (!cb) return false;
    /* THEME SPEC HAS CHANGED */
    /* NEW THEME SPEC IS IN themeUtil.ts */
    // const result = validateColorBlockAsTheme(cb);
    return false;
  });

  const copyLink = createCallback(() => {
    navigator.clipboard.writeText(
      buildSimpleEntityUrl(
        {
          type: 'color',
          id: props.id,
        },
        {}
      )
    );
    toast.success('Link copied to clipboard.');
  });

  return (
    <Bar
      suppressPop
      left={
        <DropdownMenu sameWidth>
          <DropdownMenu.Trigger
            as={TextButton}
            theme="clear"
            text={props.colorBlock()?.name ?? 'Colors'}
          />
        </DropdownMenu>
      }
      center={
        <div class="flex items-center gap-2">
          <Show when={themeDetected()}>
            <div class="text-xs opacity-70">Theme Detected</div>
          </Show>
          <TextButton
            theme="clear"
            text="Randomize Theme"
            onClick={props.onGenerateRandom}
          />
        </div>
      }
      right={
        <IconButton
          icon={ClipboardIcon}
          theme="clear"
          tooltip={{ label: 'Copy theme' }}
          onClick={copyLink}
        />
      }
    />
  );
}

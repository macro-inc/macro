import { createSignal } from 'solid-js';
import { isServer } from 'solid-js/web';
import IconX from '../../../assets/icons/icon-x.svg';
import { ThemeEditorBasic } from '../../../lib/theme/components/ThemeEditorBasic';
import { ThemeList } from '../../../lib/theme/components/ThemeList';
import { ThemeTools } from '../../../lib/theme/components/ThemeTools';
import { Draggable, DragHandle } from '../utils/UtilDraggable';

export const [dialogTheme, setDialogTheme] = createSignal<boolean>(false);

export function DialogTheme() {
  return (
    <Draggable
      initialX={isServer ? 0 : window.innerWidth - 320}
      display={dialogTheme()}
      position="fixed"
      initialY={76}
    >
      <div
        style={{
          'background-color': 'oklch(from var(--b1) l c h / 0.96)',
          border: '1px solid var(--b4)',
          'box-sizing': 'border-box',
          'border-radius': '5px',
          display: 'grid',
          width: '300px',
        }}
      >
        <div
          style={{
            'border-bottom': '1px solid var(--b4)',
            position: 'relative',
            height: '56px',
            width: '100%',
          }}
        >
          <DragHandle
            style={{
              position: 'absolute',
              height: '56px',
              width: '100%',
              left: '0',
              top: '0',
            }}
          />
          <IconX
            onClick={() => {
              setDialogTheme(false);
            }}
            style={{
              position: 'absolute',
              cursor: 'pointer',
              display: 'block',
              height: '25px',
              right: '16px',
              top: '15.5px',
            }}
            class="hover-color"
          />
        </div>
        <div
          style={{
            padding: '20px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <ThemeEditorBasic />
          <ThemeTools />
          <ThemeList />
        </div>
      </div>
    </Draggable>
  );
}

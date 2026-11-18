import { Input } from '@channel/Input/Input';
import { ComposerSurface } from '@ui';
import type { ParentProps } from 'solid-js';
import { MobileComposerContext } from './context';

type MobileComposerRootProps = ParentProps<{
  collapsed: boolean;
  height?: number;
  dictating: boolean;
  canAttach: boolean;
  onContentRef: (element: HTMLDivElement) => void;
  onLayoutRef: (element: HTMLDivElement) => void;
  onDragChange: (dragging: boolean) => void;
  onPointerDown: (event: PointerEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
}>;

/** Phone-only frame; the shared editor host keeps draft and input behavior. */
export function MobileComposerRoot(props: MobileComposerRootProps) {
  return (
    <MobileComposerContext.Provider
      value={{ collapsed: () => props.collapsed }}
    >
      <ComposerSurface
        as="div"
        data-agent-composer="chat"
        data-composer-expanded={!props.collapsed || undefined}
        class="island relative z-10 min-w-0 rounded-[24px] transition-[height] duration-200 motion-reduce:transition-none"
        style={{
          height: props.height === undefined ? undefined : `${props.height}px`,
        }}
        onPointerDown={props.onPointerDown}
        onMouseDown={props.onMouseDown}
      >
        <Input.DropZone
          onDragStart={(valid) => props.canAttach && props.onDragChange(valid)}
          onDragEnd={() => props.onDragChange(false)}
        >
          <Input.DropOverlay class="rounded-[24px]" />
          <div
            ref={props.onContentRef}
            inert={props.dictating}
            classList={{ invisible: props.dictating }}
          >
            <div
              ref={props.onLayoutRef}
              data-composer-collapsed={props.collapsed || undefined}
              data-phone-composer="true"
              class="group/composer flex min-w-0 gap-1"
              classList={{
                'h-[46px] items-center px-[18px]': props.collapsed,
                'flex-col px-1.5 pt-2 pb-1.5': !props.collapsed,
              }}
            >
              {props.children}
            </div>
          </div>
        </Input.DropZone>
      </ComposerSurface>
    </MobileComposerContext.Provider>
  );
}

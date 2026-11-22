import { Input } from '@channel/Input/Input';
import { keepToastsClearOf } from '@core/component/Toast/toast-clearance';
import { ComposerSurface } from '@ui';
import { createSignal, type ParentProps } from 'solid-js';
import { MobileComposerContext } from './context';
import './mobile-composer.css';

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
  const [attachmentHeight, setAttachmentHeight] = createSignal(0);
  return (
    <MobileComposerContext.Provider
      value={{ collapsed: () => props.collapsed, setAttachmentHeight }}
    >
      <ComposerSurface
        ref={keepToastsClearOf}
        as="div"
        data-agent-composer="chat"
        data-composer-expanded={!props.collapsed || undefined}
        class="phone-composer-surface island relative z-10 min-w-0"
        style={{
          '--composer-attachment-offset': `${attachmentHeight() > 0 ? attachmentHeight() + 4 : 0}px`,
          height: props.collapsed
            ? '46px'
            : props.height === undefined
              ? undefined
              : `${props.height}px`,
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
              class="group/composer flex min-w-0 flex-col gap-1 px-1.5 pt-2 pb-1.5"
            >
              {props.children}
            </div>
          </div>
        </Input.DropZone>
      </ComposerSurface>
    </MobileComposerContext.Provider>
  );
}

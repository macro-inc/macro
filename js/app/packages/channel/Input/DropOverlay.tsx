import { Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput } from './context';

type DropOverlayProps = JSX.HTMLAttributes<HTMLDivElement> & {
  invalidMessage?: string;
  hint?: string;
};

export function DropOverlay(props: DropOverlayProps) {
  const input = useInput();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'invalidMessage',
    'hint',
  ]);

  const open = () =>
    !!input().isDraggedOver ||
    (!!input().isDraggingOverChannel && !input().isReplyInput);
  const valid = () => input().isValidChannelDrag !== false;

  return (
    <Show when={open()}>
      <div
        class={cn(
          'absolute inset-0 z-20 flex flex-col gap-1 items-center justify-center bg-input/90 border border-edge-muted text-sm',
          local.class
        )}
        data-input-drop-overlay
        {...rest}
      >
        <Show when={valid()} fallback={local.invalidMessage ?? 'Invalid file'}>
          {local.children ?? local.hint ?? 'Drop files to attach'}
        </Show>
      </div>
    </Show>
  );
}

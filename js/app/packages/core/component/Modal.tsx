import { useIsVirtualKeyboardVisible } from '@core/mobile/virtualKeyboardDetection';
import { blockElementSignal } from '@core/signal/blockElement';
import Dialog from '@corvu/dialog';
import {
  type ComponentProps,
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
} from 'solid-js';

// See Corvu documentation for usage:
// https://corvu.dev/docs/primitives/dialog/
// https://corvu.dev/docs/state/

export function Modal(props: ComponentProps<typeof Dialog>) {
  return (
    <Dialog
      // prevents the dialog from immediately being dismissed
      closeOnOutsidePointerStrategy="pointerdown"
      closeOnOutsideFocus={false}
      // this prevents the pointer events helper from getting stuck on dismissed
      // this is because we often prevent default onMouseDown
      noOutsidePointerEvents={false}
      contextId={props.contextId}
      {...props}
    />
  );
}

export function Overlay(props: ComponentProps<typeof Dialog.Overlay<'div'>>) {
  const isVirutalKeyboardVisible = useIsVirtualKeyboardVisible();
  return (
    <Dialog.Overlay
      {...props}
      class={`flex sm:max-h-full items-center justify-content z-modal-overlay fixed inset-0 bg-modal-overlay ${props.class}`}
      style={{
        'max-height': isVirutalKeyboardVisible()
          ? 'calc(var(--viewport-height) - env(safe-area-inset-top, 0px))'
          : `calc(100dvh - env(safe-area-inset-top, 0px))`,
      }}
    >
      {props.children}
    </Dialog.Overlay>
  );
}

export function Content(props: ComponentProps<typeof Dialog.Content<'div'>>) {
  const [rect, setRect] = createSignal<DOMRect | undefined>(undefined);

  onMount(() => {
    const el = blockElementSignal();
    if (!el) {
      setRect(undefined);
      return;
    }
    setRect(el.getBoundingClientRect());

    const observer = new ResizeObserver(() => {
      setRect(el.getBoundingClientRect());
    });
    observer.observe(el);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  const positionStyle = createMemo(() => {
    const _rect = rect();
    if (_rect) {
      const centerX = _rect.left + _rect.width / 2;
      const centerY = _rect.top + _rect.height / 2;

      return {
        position: 'absolute',
        top: `${centerY}px`,
        left: `${centerX}px`,
        transform: 'translate(-50%, -50%)',
      };
    }
    return {
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
    };
  });

  return (
    <Dialog.Content
      {...props}
      class={`absolute z-modal
              min-w-96 p-3
              bg-dialog shadow
              rounded-lg border border-edge
              flex-col justify-start items-end inline-flex gap-3
              duration-slow
              corvu-open:animate-in
              corvu-open:fade-in-0 corvu-open:zoom-in-95
              corvu-closed:animate-out
              corvu-closed:fade-out-0 corvu-closed:zoom-out-95
              ${props.class}`}
      style={positionStyle() as JSX.CSSProperties}
    >
      {props.children}
    </Dialog.Content>
  );
}

export function Header(props: ComponentProps<typeof Dialog.Label<'h2'>>) {
  return (
    <Dialog.Label
      {...props}
      class={`text-ink text-lg font-semibold font-sans leading-7 ${props.class}`}
    >
      {props.children}
    </Dialog.Label>
  );
}

export function Message(props: ComponentProps<typeof Dialog.Description<'p'>>) {
  return (
    <Dialog.Description
      {...props}
      class={`text-ink-muted text-sm font-normal font-sans leading-tight ${props.class}`}
    >
      {props.children}
    </Dialog.Description>
  );
}

export function ButtonBar(props: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      class={`pt-3 justify-start items-start gap-3 inline-flex ${props.class}`}
    >
      {props.children}
    </div>
  );
}

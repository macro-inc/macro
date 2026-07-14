import {
  createRenderEffect,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { useSplitPanelOrThrow } from '../layoutUtils';

export function SplitToolbar(props: { ref: Setter<HTMLDivElement | null> }) {
  const panel = useSplitPanelOrThrow();

  // Layout / spacing / border / min-height live on <Panel.Toolbar> in
  // SplitPanel. This wrapper only mounts the portal targets so consumers
  // (<SplitToolbarLeft />, <SplitToolbarRight />) have somewhere to render
  // into.
  return (
    <div
      class="flex items-center justify-between w-full"
      data-split-toolbar
      ref={props.ref}
    >
      <div
        class="flex-1 flex items-center gap-1"
        ref={(ref) => {
          panel.layoutRefs.toolbarLeft = ref;
        }}
      />
      <div
        class="flex items-center gap-1"
        ref={(ref) => {
          panel.layoutRefs.toolbarRight = ref;
        }}
      />
    </div>
  );
}

export function SplitToolbarLeft(
  props: ParentProps<{
    class?: string;
  }>
) {
  const panel = useSplitPanelOrThrow();
  const [portalRef, setPortalRef] = createSignal<HTMLDivElement | null>(null);

  const halfWidthClasses = () =>
    'absolute h-full left-[30%] top-0 flex items-center'.split(' ');

  createRenderEffect(() => {
    const ref = portalRef();
    if (!ref) return;
    ref.style.width = '100%';
    const halfSplitState = panel.halfSplitState?.();
    if (halfSplitState?.side === 'right') {
      ref.classList.add(...halfWidthClasses());
    } else {
      ref.classList.remove(...halfWidthClasses());
    }
    if (props.class) {
      ref.classList.add(props.class);
    }
  });

  return (
    <Show when={panel.layoutRefs.toolbarLeft}>
      <Portal
        ref={(div) => {
          setPortalRef(div);
          div.style.display = 'contents';
        }}
        mount={panel.layoutRefs.toolbarLeft}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

export function SplitToolbarRight(props: ParentProps<{ order?: number }>) {
  const panel = useSplitPanelOrThrow();
  const [portalRef, setPortalRef] = createSignal<HTMLDivElement | null>(null);

  const halfWidthClasses = () =>
    'absolute h-full right-[70%] top-0 flex items-center'.split(' ');

  createRenderEffect(() => {
    const ref = portalRef();
    if (!ref) return;
    ref.style.order = props.order?.toString() ?? '0';
    const halfSplitState = panel.halfSplitState?.();
    if (halfSplitState?.side === 'left') {
      ref.classList.add(...halfWidthClasses());
    } else {
      ref.classList.remove(...halfWidthClasses());
    }
  });
  return (
    <Show when={panel.layoutRefs.toolbarRight}>
      <Portal
        ref={(div) => {
          setPortalRef(div);
          div.style.display = 'contents';
        }}
        mount={panel.layoutRefs.toolbarRight}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

import MacroJump from '@app/component/MacroJump';
import { cornerClip } from '@core/util/clipPath';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  type Setter,
  Show,
} from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { SplitDrawerGroup } from './SplitDrawerContext';
import { SplitHeader } from './SplitHeader';
import { SplitModalProvider } from './SplitModalContext';
import { SplitToolbar } from './SplitToolbar';
import './splitContainer.css';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ClippedPanel } from '@core/component/ClippedPanel';

function EdgeDecor(props: { isActive: boolean }) {
  return (
    <div
      class="absolute inset-0 border border-accent opacity-50 pointer-events-none mask-anim"
      classList={{ active: props.isActive }}
      style={{
        'clip-path': cornerClip('0.5rem', 0, 0, 0),
      }}
    >
      <div class="size-[0.465rem] bg-accent [clip-path:polygon(0%_0%,100%_0%,0%_100%)]"></div>
    </div>
  );
}

export function SplitContainer(
  props: ParentProps<{ id: string; ref: (elem: HTMLDivElement) => void }>
) {
  const panel = useSplitPanelOrThrow();
  if (!panel)
    throw new Error('<SplitContainer /> must be used within a <SplitLayout />');

  const [ref, setRef] = createSignal<HTMLDivElement>();
  createEffect(
    on([ref], () => {
      ref()?.focus();
    })
  );
  const isSpotLight = () => panel.handle.isSpotLight();

  const [headerRef, setHeaderRef] = createSignal<HTMLDivElement | null>(null);
  const [toolbarRef, setToolbarRef] = createSignal<HTMLDivElement | null>(null);

  const headerSize = createElementSize(headerRef);
  const toolbarSize = createElementSize(toolbarRef);
  const offsetTop = createMemo(() => {
    const offset = (headerSize.height ?? 0) + (toolbarSize.height ?? 0);
    panel.setContentOffsetTop(offset);
    return offset;
  });

  const multipleSplits = () => {
    const splits = globalSplitManager()?.splits?.();
    return Boolean(splits && splits.length > 1);
  };

  return (
    <SplitModalProvider>
      <SplitDrawerGroup
        contentOffsetTop={offsetTop}
        panelSize={panel.panelSize}
      >
        <Show when={isSpotLight()}>
          <div
            class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
            onClick={() => panel.handle.toggleSpotlight(false)}
          />
          <div class="fixed inset-[4rem] bg-panel shadow-xl rounded-tl-[1.5rem]" />
        </Show>
        <div
          class="pointer-events-none text-accent"
          classList={{
            'absolute inset-0 z-1': !isSpotLight(),
          }}
        >
          <EdgeDecor
            isActive={
              panel.handle.isActive() && multipleSplits() && !isSpotLight()
            }
          />
        </div>
        <div
          data-split-id={props.id}
          data-split-container
          tabindex={-1}
          ref={(ref) => {
            setRef(ref);
            props.ref(ref);
          }}
          class="@container/split flex flex-col border-edge-muted border border-t-0 min-h-0 bg-panel bracket-never"
          classList={{
            'opacity-85': !panel.handle.isActive(),
            'opacity-100': panel.handle.isActive() || isSpotLight(),
            'size-full': !isSpotLight(),
            'fixed inset-[4rem] z-modal-overlay isolate opacity-50':
              isSpotLight(),
          }}
          style={{
            'clip-path': cornerClip('0.5rem', 0, 0, 0),
          }}
        >
          <SplitHeader ref={setHeaderRef} />
          <SplitToolbar ref={setToolbarRef} />
          <div class="size-full overflow-hidden">{props.children}</div>
          <Show when={isSpotLight()}>
            <MacroJump tabbableParent={ref} />
          </Show>
        </div>
      </SplitDrawerGroup>
    </SplitModalProvider>
  );
}

export function SplitlikeContainer(
  props: ParentProps<{
    setSpotlight: Setter<boolean>;
    spotlight: Accessor<boolean>;
    active?: boolean;
    tl?: boolean;
    tr?: boolean;
    br?: boolean;
    bl?: boolean;
  }>
) {
  const [panel, setPanel] = createSignal<HTMLDivElement | null>(null);
  const panelSize = createElementSize(panel);

  return (
    <SplitModalProvider>
      <SplitDrawerGroup panelSize={panelSize} contentOffsetTop={() => 0}>
        <Show when={props.spotlight()}>
          <MacroJump tabbableParent={() => panel() ?? undefined} />
          <div
            class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
            onClick={() => props.setSpotlight(false)}
          />
          <div class="fixed inset-[4rem] bg-panel shadow-xl" />
        </Show>

        <div
          data-split-container
          tabindex={-1}
          ref={setPanel}
          class="@container/split flex flex-col min-h-0 bracket-never"
          classList={{
            'size-full': !props.spotlight(),
            'fixed inset-[4rem] z-modal isolate': props.spotlight(),
          }}
        >
          <ClippedPanel
            active={props.active}
            tl={props.tl}
            tr={props.tr}
            bl={props.bl}
            br={props.br}
          >
            <div class="size-full overflow-hidden">{props.children}</div>
          </ClippedPanel>
        </div>
      </SplitDrawerGroup>
    </SplitModalProvider>
  );
}

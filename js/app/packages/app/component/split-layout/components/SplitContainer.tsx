import { type Accessor, createEffect, createMemo, createSignal, on, type ParentProps, type Setter, Show} from 'solid-js';
import { createElementSize } from '@solid-primitives/resize-observer';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { SplitModalProvider } from './SplitModalContext';
import { SplitDrawerGroup } from './SplitDrawerContext';
import { isRightPanelOpen } from '@core/signal/layout';
import { useSplitPanelOrThrow } from '../layoutUtils';
import MacroJump from '@app/component/MacroJump';
import { SplitToolbar } from './SplitToolbar';
import { SplitHeader } from './SplitHeader';

export function SplitContainer(
  props: ParentProps<{
    ref: (elem: HTMLDivElement) => void;
    active?: boolean;
    tl?: boolean;
    tr?: boolean;
    br?: boolean;
    bl?: boolean;
    id: string;
  }>
) {
  const panel = useSplitPanelOrThrow();
  if(!panel){throw new Error('<SplitContainer /> must be used within a <SplitLayout />')};

  const [ref, setRef] = createSignal<HTMLDivElement>();
  createEffect(
    on([ref], () => {
      ref()?.focus();
    })
  );

  const [toolbarRef, setToolbarRef] = createSignal<HTMLDivElement | null>(null);
  const [headerRef, setHeaderRef] = createSignal<HTMLDivElement | null>(null);

  const headerSize = createElementSize(headerRef);
  const toolbarSize = createElementSize(toolbarRef);
  const offsetTop = createMemo(() => {
    const offset = (headerSize.height ?? 0) + (toolbarSize.height ?? 0);
    panel.setContentOffsetTop(offset);
    return offset;
  });

  function multipleSplits(){
    const splits = globalSplitManager()?.splits?.();
    return Boolean(splits && splits.length > 1);
  };

  return (
    <SplitModalProvider>
      <SplitDrawerGroup
        contentOffsetTop={offsetTop}
        panelSize={panel.panelSize}
      >
        <Show when={panel.handle.isSpotLight()}>
          <div
            class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
            onClick={() => panel.handle.toggleSpotlight(false)}
          />
          <div class="fixed inset-[4rem] bg-panel shadow-xl rounded-tl-[1.5rem]" />
        </Show>

        <ClippedPanel
          active={panel.handle.isActive() && multipleSplits() && !panel.handle.isSpotLight()}
          tl={panel.handle.isFirst()}
          tr={panel.handle.isLast() && !isRightPanelOpen()}
        >
          <div
            classList={{
              'fixed inset-[4rem] z-modal-overlay isolate opacity-50': panel.handle.isSpotLight(),
              'opacity-100': panel.handle.isActive() || panel.handle.isSpotLight(),
              'size-full': !panel.handle.isSpotLight(),
              'opacity-85': !panel.handle.isActive(),
            }}
            class="@container/split flex flex-col min-h-0 bracket-never"
            ref={(ref) => { setRef(ref); props.ref(ref)}}
            data-split-id={props.id}
            data-split-container
            tabindex={-1}
          >
            <SplitHeader ref={setHeaderRef} />
            <SplitToolbar ref={setToolbarRef} />
            <div class="size-full overflow-hidden">{props.children}</div>
            <Show when={panel.handle.isSpotLight()}>
              <MacroJump tabbableParent={ref} />
            </Show>
          </div>
        </ClippedPanel>
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
          class="@container/split flex flex-col min-h-0 bracket-never"
          classList={{
            'fixed inset-[4rem] z-modal isolate': props.spotlight(),
            'size-full': !props.spotlight(),
          }}
          data-split-container
          tabindex={-1}
          ref={setPanel}
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

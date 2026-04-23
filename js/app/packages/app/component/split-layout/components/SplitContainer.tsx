import MacroJump from '@app/component/MacroJump';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  Show,
} from 'solid-js';
import { useSplitPanelOrThrow } from '../layoutUtils';
import { SplitDrawerGroup } from './SplitDrawerContext';
import { SplitHeader } from './SplitHeader';
import { SplitToolbar } from './SplitToolbar';
import { RoundPanel, type RoundPanelProps } from '@core/component/RoundPanel';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobile } from '@core/mobile/isMobile';

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
  if (!panel) {
    throw new Error('<SplitContainer /> must be used within a <SplitLayout />');
  }

  const [ref, setRef] = createSignal<HTMLDivElement>();
  createEffect(
    on([ref], () => {
      if (isMobile()) return;
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

  function multipleSplits() {
    const splits = globalSplitManager()?.splits?.();
    return Boolean(splits && splits.length > 1);
  }

  function MaybeRoundPanel(props: RoundPanelProps) {
    return (
      <Show when={!isMobile()} fallback={props.children}>
        <RoundPanel {...props} />
      </Show>
    );
  }

  return (
    <SplitDrawerGroup contentOffsetTop={offsetTop} panelSize={panel.panelSize}>
      <Show when={panel.handle.isSpotLight()}>
        <div
          class="fixed inset-0 w-screen h-screen z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted"
          onClick={() => panel.handle.toggleSpotlight(false)}
        />
        <div class="fixed inset-[4rem] bg-panel shadow-xl" />
      </Show>

      <div
        classList={{
          'fixed inset-[4rem] z-modal-overlay isolate opacity-50':
            panel.handle.isSpotLight(),
          'opacity-100': panel.isPanelActive() || panel.handle.isSpotLight(),
          'size-full': !panel.handle.isSpotLight(),
          'opacity-85': !panel.isPanelActive() && !isMobile(),
        }}
        ref={(ref) => {
          setRef(ref);
          props.ref(ref);
        }}
        data-split-id={props.id}
        class="bracket-never"
        data-split-container
        data-modal={panel.handle.isSpotLight()}
        tabindex={-1}
      >
        <MaybeRoundPanel
          active={
            panel.isPanelActive() &&
            multipleSplits() &&
            !panel.handle.isSpotLight()
          }
          // TODO (seamus) temporary disabling split corners
          // tl={props.tl}
          // bl={props.bl}
          // tr={props.tr}
        >
          <div class="flex flex-col min-h-0 size-full bg-panel overflow-hidden">
            <SplitHeader ref={setHeaderRef} />
            <SplitToolbar ref={setToolbarRef} />
            <div class="@container/split size-full overflow-hidden relative">
              {props.children}
            </div>
            <Show when={panel.handle.isSpotLight()}>
              <MacroJump tabbableParent={ref} />
            </Show>
          </div>
        </MaybeRoundPanel>
      </div>
    </SplitDrawerGroup>
  );
}

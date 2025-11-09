import { IconButton } from '@core/component/IconButton';
import { ResizeZoneContext } from '@core/component/Resize/Resize';
import { TOKENS } from '@core/hotkey/tokens';
import { cornerClip } from '@core/util/clipPath';
import CollapseIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import CaretLeft from '@icon/regular/caret-left.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import SplitIcon from '@icon/regular/square-split-horizontal.svg';
import CloseIcon from '@icon/regular/x.svg';
import {
  createEffect,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { SplitLayoutContext, SplitPanelContext } from '../context';

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      size="sm"
      icon={CaretLeft}
      tooltip={{ label: 'Go Back', hotkeyToken: TOKENS.split.back }}
      disabled={!context.handle.canGoBack()}
      theme="current"
      onClick={context.handle.goBack}
    />
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      size="sm"
      icon={CaretRight}
      tooltip={{ label: 'Go Forward', hotkeyToken: TOKENS.split.forward }}
      disabled={!context.handle.canGoForward()}
      theme="current"
      onClick={context.handle.goForward}
    />
  );
}

// TODO: Move to Dock
//   (would likely require global split context, or at least a bit higher in the tree)
function SplitCreateButton() {
  const context = useContext(SplitLayoutContext);
  const zoneContext = useContext(ResizeZoneContext);
  if (!context || !zoneContext) return '';

  // TODO (seamus) : What should the behavior be for not enough space for split?
  // Block, replace, toast? This should be consistent everywhere:
  // 1) keyboard shortcut
  // 2) here
  // 3) opt-click and open-in-split button
  const canAdd = () => zoneContext.canFit({ minSize: 400 });

  return (
    <IconButton
      size="sm"
      icon={SplitIcon}
      theme="current"
      disabled={!canAdd()}
      tooltip={{
        hotkeyToken: canAdd() ? TOKENS.global.createNewSplit : undefined,
        label: canAdd()
          ? 'Create New Split'
          : 'Not Enough Space for a New Split',
      }}
      onClick={() => {
        context.manager.createNewSplit({
          type: 'component',
          id: 'unified-list',
        });
      }}
    />
  );
}

function SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  const show = () => {
    return layout.manager.splits().length > 1;
  };
  return (
    <Show when={show()}>
      <IconButton
        size="sm"
        icon={context.handle.isSpotLight() ? CollapseIcon : ExpandIcon}
        theme="current"
        tooltip={{
          hotkeyToken: TOKENS.split.spotlight.toggle,
          label: context.handle.isSpotLight()
            ? 'Minimize Split'
            : 'Spotlight Split',
        }}
        onClick={() => context.handle.toggleSpotlight()}
      />
    </Show>
  );
}

function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <IconButton
      size="sm"
      iconSize={16}
      icon={CloseIcon}
      theme="current"
      tooltip={{ label: 'Close', hotkeyToken: TOKENS.split.close }}
      onClick={context.handle.close}
    />
  );
}

function SplitControlButtons() {
  return (
    <div class="flex flex-row items-center px-2 border-t border-t-edge-muted border-b border-b-edge-muted h-full shrink-0">
      <SplitCloseButton />
      <SplitBackButton />
      <SplitForwardButton />
    </div>
  );
}

export function SplitHeader(props: { ref: Setter<HTMLDivElement | null> }) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');

  return (
    <div
      class="isolate relative bg-edge-muted w-full h-10 overflow-clip text-ink shrink-0"
      data-split-header
      ref={props.ref}
    >
      <div
        class="absolute inset-0 flex justify-start items-center bg-panel"
        style={{
          'clip-path': cornerClip('calc(0.5rem + 0.5px)', 0, 0, 0),
        }}
      >
        <SplitControlButtons />
        <div
          class="relative w-fit min-w-0 h-full shrink"
          ref={(ref) => {
            ctx.layoutRefs.headerLeft = ref;
          }}
        />

        {/* space filler */}
        <div class="border-t border-t-edge-muted border-b border-b-edge-muted h-full grow-1" />

        <div
          class="border-t border-t-edge-muted border-b border-b-edge-muted min-w-4 h-full shrink-0"
          ref={(ref) => {
            ctx.layoutRefs.headerRight = ref;
          }}
        />
        <div class="z-2 relative flex items-center bg-panel pr-2 border-t border-t-edge-muted border-b border-b-edge-muted h-full">
          <SplitSpotlightButton />
          <SplitCreateButton />
        </div>
      </div>
    </div>
  );
}

export function SplitHeaderLeft(props: ParentProps<{ order?: number }>) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderLeft> must be used within a <SplitLayout>');
  const [portalRef, setPortalRef] = createSignal<HTMLDivElement | null>(null);
  createEffect(() => {
    const ref = portalRef();
    if (!ref) return;
    ref.style.order = props.order?.toString() ?? '0';
  });
  return (
    <Show when={ctx.layoutRefs.headerLeft}>
      <Portal
        mount={ctx.layoutRefs.headerLeft}
        ref={(div) => {
          setPortalRef(div);
          div.style.display = 'contents';
        }}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

export function SplitHeaderRight(props: ParentProps<{ order?: number }>) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderRight> must be used within a <SplitLayout>');
  const [portalRef, setPortalRef] = createSignal<HTMLDivElement | null>(null);
  createEffect(() => {
    const ref = portalRef();
    if (!ref) return;
    ref.style.order = props.order?.toString() ?? '0';
  });
  return (
    <Show when={ctx.layoutRefs.headerRight}>
      <Portal
        mount={ctx.layoutRefs.headerRight}
        ref={(div) => {
          setPortalRef(div);
          div.style.display = 'contents';
        }}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

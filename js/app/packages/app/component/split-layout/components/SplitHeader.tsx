import { LabelAndHotKey } from '@core/component/Tooltip';
import {
  ENABLE_PREVIEW,
  ENABLE_PROJECT_VIEW_PREVIEW,
} from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CollapseIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import CaretLeft from '@icon/regular/caret-left.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import SplitIcon from '@icon/regular/square-half.svg';
import CloseIcon from '@icon/regular/x.svg';
import { Button } from '@ui/components/Button';
import {
  createMemo,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import { canSpotlight } from '../utils/canSpotlight';
import { cn } from '@ui/utils/classname';
import { isListViewID } from '@app/constants/list-views';

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      class="p-1"
      tooltip={
        <LabelAndHotKey label="Go Back" hotkeyToken={TOKENS.split.go.back} />
      }
      disabled={!context.handle.canGoBack()}
      onClick={context.handle.goBack}
    >
      <CaretLeft class="h-4" />
    </Button>
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      tooltip={
        <LabelAndHotKey
          label="Go Forward"
          hotkeyToken={TOKENS.split.go.forward}
        />
      }
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
      class={cn(
        'p-1',
        isMobile() && !context.handle.canGoForward() && 'hidden'
      )}
    >
      <CaretRight class="h-4" />
    </Button>
  );
}

function SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  return (
    <Show when={canSpotlight(layout.manager)}>
      <Button
        class="p-1 rounded-xs"
        tooltip={
          <LabelAndHotKey
            label={
              context.handle.isSpotLight()
                ? 'Minimize Split'
                : 'Spotlight Split'
            }
            hotkeyToken={TOKENS.window.spotlight.toggle}
          />
        }
        onClick={() => context.handle.toggleSpotlight()}
      >
        {context.handle.isSpotLight() ? (
          <CollapseIcon class="h-4" />
        ) : (
          <ExpandIcon class="h-4" />
        )}
      </Button>
    </Show>
  );
}

function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return null;

  const label = createMemo(() => {
    const isOnlySplit = layout.manager.splits().length === 1;
    const isNotUnifiedList = !isListViewID(context.handle.content().id);
    return isOnlySplit && isNotUnifiedList ? 'Return to list' : 'Close';
  });

  return (
    <Show when={layout.manager.splits().length > 1}>
      <Button
        class="p-1"
        tooltip={
          <LabelAndHotKey label={label()} hotkeyToken={TOKENS.split.close} />
        }
        onClick={context.handle.close}
      >
        <CloseIcon class="w-4 h-4" />
      </Button>
    </Show>
  );
}

function _SplitPreviewToggle() {
  const context = useContext(SplitPanelContext);
  if (!ENABLE_PREVIEW || !context || !context.previewState) return null;

  // Only show toggle for unified-list component and project block
  const isUnifiedList = createMemo(() => {
    const content = context.handle.content();
    if (ENABLE_PROJECT_VIEW_PREVIEW && content.type === 'project') return true;
    return content.type === 'component' && content.id === 'unified-list';
  });

  const [preview, setPreview] = context.previewState;

  return (
    <Show when={isUnifiedList()}>
      <div class="max-sm:rotate-90">
        <Button
          class="p-1"
          classList={{
            'bg-accent/20 text-accent': preview(),
          }}
          tooltip={
            <LabelAndHotKey
              label={!preview() ? 'Split View (Preview)' : 'Full View (List)'}
              hotkeyToken={TOKENS.unifiedList.togglePreview}
            />
          }
          tabIndex={-1}
          onClick={() => setPreview((prev) => !prev)}
        >
          <SplitIcon class="h-4" />
        </Button>
      </div>
    </Show>
  );
}

function _SplitControlButtons() {
  return (
    <div class="flex flex-row items-center px-2 h-full shrink-0">
      <div class="mobile:hidden">
        <SplitCloseButton />
      </div>
      <SplitBackButton />
      <SplitForwardButton />
    </div>
  );
}

export function SplitHeader(props: { ref: Setter<HTMLDivElement | null> }) {
  const panel = useContext(SplitPanelContext);
  if (!panel)
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');
  const layout = useContext(SplitLayoutContext);

  const shouldShowRightmost = () =>
    !isTouchDevice() && layout && canSpotlight(layout.manager);

  return (
    <div
      class="isolate relative w-full h-10 touch:h-11 overflow-clip text-ink shrink-0 border-b border-edge-muted"
      data-split-header
      ref={props.ref}
    >
      <div class="absolute inset-0 flex justify-start items-center bg-panel">
        <div class="z-annotation-layer relative flex items-center bg-panel pl-2 mobile:pl-0 h-full">
          <div class="mobile:hidden">
            <SplitCloseButton />
          </div>
          <Show when={!(isMobile() && isListViewID(panel.handle.content().id))}>
            <SplitBackButton />
            <SplitForwardButton />
          </Show>
        </div>
        <div
          class="relative min-w-0 h-full grow shrink pl-2 flex items-center gap-0.5"
          ref={(ref) => {
            panel.layoutRefs.headerLeft = ref;
          }}
        />

        <div
          class={cn(
            'min-w-4 h-full shrink-0 flex items-center gap-0.5 pl-2',
            !shouldShowRightmost() && 'pr-2'
          )}
          ref={(ref) => {
            panel.layoutRefs.headerRight = ref;
          }}
        />

        <Show when={shouldShowRightmost()}>
          <div
            class={
              'pl-0.5 pr-2 z-annotation-layer relative flex items-center gap-0.5 h-full order-last'
            }
          >
            <SplitSpotlightButton />
          </div>
        </Show>
      </div>
    </div>
  );
}

export function SplitHeaderLeft(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderLeft> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerLeft}>
      <Portal
        mount={ctx.layoutRefs.headerLeft}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

export function SplitHeaderRight(props: ParentProps) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeaderRight> must be used within a <SplitLayout>');

  return (
    <Show when={ctx.layoutRefs.headerRight}>
      <Portal
        mount={ctx.layoutRefs.headerRight}
        ref={(div) => (div.style.display = 'contents')}
      >
        {props.children}
      </Portal>
    </Show>
  );
}

import { isListViewID } from '@app/constants/list-views';
import {
  ENABLE_PREVIEW,
  ENABLE_PROJECT_VIEW_PREVIEW,
} from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import CollapseIcon from '@phosphor/arrows-in.svg';
import ExpandIcon from '@phosphor/arrows-out.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import EyeIcon from '@phosphor/eye.svg';
import EyeSlashIcon from '@phosphor/eye-slash.svg';
import CloseIcon from '@phosphor/x.svg';
import { Button, cn } from '@ui';
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

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      class="p-1"
      label="Go Back"
      hotkey={TOKENS.split.go.back}
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
      label="Go Forward"
      hotkey={TOKENS.split.go.forward}
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

function _SplitSpotlightButton() {
  const context = useContext(SplitPanelContext);
  const layout = useContext(SplitLayoutContext);
  if (!context || !layout) return '';
  return (
    <Show when={canSpotlight(layout.manager)}>
      <Button
        class="p-1 rounded-xs hidden"
        label={
          context.handle.isSpotLight() ? 'Minimize Split' : 'Spotlight Split'
        }
        hotkey={TOKENS.window.spotlight.toggle}
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
        label={label()}
        hotkey={TOKENS.split.close}
        onClick={context.handle.close}
      >
        <CloseIcon class="size-4" />
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
          label={!preview() ? 'Split View (Preview)' : 'Full View (List)'}
          hotkey={TOKENS.unifiedList.togglePreview}
          tabIndex={-1}
          onClick={() => setPreview((prev) => !prev)}
        >
          {preview() ? <EyeSlashIcon /> : <EyeIcon />}
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
  if (!panel) {
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');
  }

  return (
    <div
      class="isolate relative w-full h-full overflow-clip text-ink"
      data-split-header
      ref={props.ref}
    >
      <div class="absolute inset-0 flex justify-start items-center">
        <div class="relative flex items-center pl-2 mobile:pl-0 h-full">
          <div class="mobile:hidden">
            <SplitCloseButton />
          </div>
          <Show when={!(isMobile() && isListViewID(panel.handle.content().id))}>
            <SplitBackButton />
            <SplitForwardButton />
          </Show>
        </div>

        <div
          class="relative min-w-0 h-full shrink pl-2 flex items-center gap-0.5"
          ref={(ref) => {
            panel.layoutRefs.headerLeft = ref;
          }}
        />

        {/*<Show when={shouldShowRightmost()}>
          <div
            class={
              'pl-2 z-annotation-layer relative flex items-center gap-0.5 h-full'
            }
          >
            <SplitSpotlightButton />
          </div>
        </Show>*/}

        <div
          class="min-w-4 h-full grow shrink flex items-center justify-end gap-0.5 px-2"
          ref={(ref) => {
            panel.layoutRefs.headerRight = ref;
          }}
        />
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

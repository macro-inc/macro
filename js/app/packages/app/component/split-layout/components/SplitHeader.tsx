import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { ENABLE_PREVIEW } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import CollapseIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import CaretLeft from '@icon/regular/caret-left.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import SplitIcon from '@icon/regular/square-split-horizontal.svg';
import CloseIcon from '@icon/regular/x.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { SplitLayoutContext, SplitPanelContext } from '../context';
import { useSplitLayout } from '../layout';
import {
  createActiveSplitMemo,
  createIsActiveSplitContentMemo,
} from '../layoutUtils';
import { canSpotlight } from '../utils/canSpotlight';

function SplitBackButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      class="p-1 *:h-4"
      tooltip={
        <LabelAndHotKey label="Go Back" hotkeyToken={TOKENS.split.go.back} />
      }
      disabled={!context.handle.canGoBack()}
      onClick={context.handle.goBack}
    >
      <CaretLeft />
    </Button>
  );
}

function SplitForwardButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return '';
  return (
    <Button
      class="p-1 *:h-4"
      tooltip={
        <LabelAndHotKey
          label="Go Forward"
          hotkeyToken={TOKENS.split.go.forward}
        />
      }
      disabled={!context.handle.canGoForward()}
      onClick={context.handle.goForward}
    >
      <CaretRight />
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
        class="p-1 *:h-4"
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
        {context.handle.isSpotLight() ? <CollapseIcon /> : <ExpandIcon />}
      </Button>
    </Show>
  );
}

function SplitCloseButton() {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      class="p-1 *:h-4"
      tooltip={
        <LabelAndHotKey label="Close" hotkeyToken={TOKENS.window.close} />
      }
      onClick={context.handle.close}
    >
      <CloseIcon />
    </Button>
  );
}

function SplitPreviewToggle() {
  const context = useContext(SplitPanelContext);
  if (!ENABLE_PREVIEW || !context || !context.previewState) return null;

  // Only show toggle for unified-list component, not for blocks
  const isUnifiedList = createMemo(() => {
    const content = context.handle.content();
    return content.type === 'component' && content.id === 'unified-list';
  });

  const [preview, setPreview] = context.previewState;

  return (
    <Show when={isUnifiedList()}>
      <div class="max-sm:rotate-90">
        <Button
          class="p-1 *:h-4"
          classList={{
            'bg-accent/20 text-accent': preview(),
          }}
          tooltip={
            <LabelAndHotKey
              label={!preview() ? 'Split View (Preview)' : 'Full View (List)'}
              hotkeyToken={TOKENS.unifiedList.togglePreview}
            />
          }
          onClick={() => setPreview((prev) => !prev)}
        >
          <SplitIcon />
        </Button>
      </div>
    </Show>
  );
}

function SplitControlButtons() {
  return (
    <div class="flex flex-row items-center px-2 h-full shrink-0">
      <div class="touch:mobile-width:hidden">
        <SplitCloseButton />
      </div>
      <SplitBackButton />
      <SplitForwardButton />
    </div>
  );
}

function SplitSettingsButton() {
  const { replaceSplit } = useSplitLayout();
  const activeSplit = createActiveSplitMemo();
  const isSettingsSplitOpen = createIsActiveSplitContentMemo(
    activeSplit,
    'component',
    'settings'
  );

  return (
    <Button
      class="p-1 *:h-4"
      classList={{
        'bg-accent/20 text-accent': isSettingsSplitOpen(),
      }}
      tooltip={
        <LabelAndHotKey
          label={isSettingsSplitOpen() ? 'Close Settings' : 'Open Settings'}
          hotkeyToken={TOKENS.global.toggleSettings}
        />
      }
      onClick={() => {
        if (isSettingsSplitOpen()) {
          activeSplit()?.goBack();
          return;
        }
        replaceSplit({ type: 'component', id: 'settings' });
      }}
    >
      <IconGear />
    </Button>
  );
}

export function SplitHeader(props: { ref: Setter<HTMLDivElement | null> }) {
  const ctx = useContext(SplitPanelContext);
  if (!ctx)
    throw new Error('<SplitHeader> must be used within a <SplitLayout>');

  return (
    <div
      class="isolate relative w-full h-10 overflow-clip text-ink shrink-0"
      data-split-header
      ref={props.ref}
    >
      <div class="absolute inset-0 flex justify-start items-center bg-panel border-b border-b-edge-muted">
        <SplitControlButtons />
        <div
          class="relative w-fit min-w-0 h-full shrink"
          ref={(ref) => {
            ctx.layoutRefs.headerLeft = ref;
          }}
        />

        {/* space filler */}
        <div class="h-full grow-1" />

        <Show when={!isTouchDevice() || !isMobileWidth()}>
          <div
            class="min-w-4 h-full shrink-0"
            ref={(ref) => {
              ctx.layoutRefs.headerRight = ref;
            }}
          />
          <div class="z-2 relative flex items-center bg-panel pr-2 h-full">
            <EntityNavigationIndicator />
            <SplitPreviewToggle />
            <SplitSpotlightButton />
          </div>
        </Show>
        <Show when={isTouchDevice()}>
          <div class="z-2 relative flex items-center bg-panel pr-2 h-full">
            <SplitSettingsButton />
          </div>
        </Show>
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

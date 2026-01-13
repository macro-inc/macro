import EntityNavigationIndicator from '@app/component/EntityNavigationIndicator';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import CollapseIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import CaretLeft from '@icon/regular/caret-left.svg';
import CaretRight from '@icon/regular/caret-right.svg';
import CloseIcon from '@icon/regular/x.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import MacroCreateIcon from '@macro-icons/macro-create-b.svg';
import { Button } from '@ui/components/Button';
import {
  createEffect,
  createSignal,
  type ParentProps,
  type Setter,
  Show,
  useContext,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { setCreateMenuOpen } from '../../Launcher';
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
  const { getSplitCount } = useSplitLayout();
  if (!context) return null;

  // Only show close button when there are multiple splits
  const hasMultipleSplits = () => getSplitCount() > 1;

  return (
    <Show when={hasMultipleSplits()}>
      <Button
        class="p-1 *:h-4"
        tooltip={<LabelAndHotKey label="Close" />}
        onClick={context.handle.close}
      >
        <CloseIcon />
      </Button>
    </Show>
  );
}

function SplitControlButtons() {
  const { getSplitCount } = useSplitLayout();
  const hasMultipleSplits = () => getSplitCount() > 1;

  return (
    <div class="flex flex-row items-center pl-2 h-full shrink-0">
      <div class="touch:mobile-width:hidden">
        <SplitCloseButton />
      </div>
      <Show
        when={hasMultipleSplits()}
        fallback={
          <Button
            class="rounded-full text-accent hover:text-ink hover:bg-accent border-edge-muted px-2.5 py-2"
            tooltip={
              <LabelAndHotKey
                label="Create"
                hotkeyToken={TOKENS.global.createCommand}
              />
            }
            onClick={() => {
              setCreateMenuOpen(true);
            }}
          >
            <svg
              class="text-accent shrink-0"
              width="17"
              viewBox="0 0 360 239"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clip-path="url(#clip0_2382_18)">
                <path d="M93.4109 0.00012207L59.8478 13.1631V100.265L79.7959 119.107V138.001L59.8478 119.142V100.265L33.5626 75.4445L-0.000518799 88.6016V188.556C-0.000518799 190.457 0.387539 192.339 1.13843 194.086C1.89127 195.832 2.99141 197.407 4.3729 198.715L46.2017 238.268L79.794 225.111V138.009L185.839 238.27L219.431 225.113V138.011L325.51 238.272L359.074 225.115V125.161C359.074 123.259 358.686 121.377 357.935 119.631C357.182 117.884 356.082 116.309 354.7 115.003L233.081 0.00012207L199.483 13.1631V100.265L219.431 119.118L219.237 137.819L199.483 119.148V100.265L93.4109 0.00012207Z" fill="currentColor" />
              </g>
              <defs>
                <clipPath id="clip0_2382_18">
                  <rect width="359.074" height="238.268" fill="white" />
                </clipPath>
              </defs>
            </svg>

            <svg
              class="text-ink shrink-0"
              width="60"
              viewBox="0 0 1209 156"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g clip-path="url(#clip0_2458_5)">
                <path d="M1027.78 0V35.7994H1166.02C1169.55 35.7994 1172.03 38.259 1172.03 41.7667V119.331H1208.09V41.7667C1208.09 18.9112 1189.04 0 1166.02 0H1027.78ZM1172.03 119.331H1033.79C1030.26 119.331 1027.78 116.871 1027.78 113.364V35.7994H991.718V113.364C991.718 136.217 1010.77 155.13 1033.79 155.13H1172.03V119.331Z" fill="currentColor" />
                <path d="M787.364 0.00384521V35.8033H925.602C929.135 35.8033 931.613 38.2629 931.613 41.7705V65.6374C931.613 69.1451 929.135 71.6047 925.602 71.6047H787.364V35.8033L751.301 35.8052V155.136H787.364V107.404H899.43L923.471 155.136H963.795L938.604 105.121C955.337 99.5888 967.675 83.9737 967.675 65.6394V41.7724C967.675 18.9151 948.625 0.00384521 925.602 0.00384521H787.364Z" fill="currentColor" />
                <path d="M552.956 0C529.935 0 510.885 18.9112 510.885 41.7667V119.331H546.87V155.119H727.259V119.319L546.947 119.325V41.7667C546.947 38.259 549.425 35.7994 552.956 35.7994H727.259V0H552.956Z" fill="currentColor" />
                <path d="M306.531 0.00384521V35.8033H444.77C448.304 35.8033 450.782 38.2629 450.782 41.7705V71.6027H306.531V35.8033H270.468V155.134H306.531V107.402H450.782V155.134H486.842V41.7686C486.842 18.9151 467.792 0.00384521 444.77 0.00384521H306.531Z" fill="currentColor" />
                <path d="M36.0627 0V35.7994H58.691C60.539 35.7994 62.3426 36.3783 63.8381 37.4571C65.3355 38.5359 66.4513 40.0551 67.0247 41.8013L104.25 155.13H142.178L179.515 41.4743C180.056 39.8244 181.108 38.3879 182.522 37.3686C183.936 36.3494 185.639 35.7994 187.386 35.7994H210.365V155.13H246.428V0H161.219C159.471 0 157.77 0.549991 156.356 1.56921C154.942 2.58842 153.89 4.02494 153.348 5.67491L123.215 97.3985L93.0799 5.67491C92.5394 4.02494 91.4856 2.58842 90.0714 1.56921C88.6592 0.549991 86.9565 0 85.2091 0L36.0627 0ZM36.0627 35.7994H0V155.13H36.0627V35.7994Z" fill="currentColor" />
              </g>
              <defs>
                <clipPath id="clip0_2458_5">
                  <rect width="1208.09" height="155.132" fill="white" />
                </clipPath>
              </defs>
            </svg>


          </Button>
        }
      >
        <SplitBackButton />
        <SplitForwardButton />
      </Show>
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
        replaceSplit({ content: { type: 'component', id: 'settings' } });
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
      <div class="absolute inset-0 flex justify-start items-center bg-panel">
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

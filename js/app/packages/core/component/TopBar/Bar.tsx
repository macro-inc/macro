import { isInBlock, useIsNestedBlock } from '@core/block';
import { observedSize } from '@core/directive/observedSize';
import { TOP_BAR_HEIGHT } from '@core/signal/layout';
import { throttle } from '@solid-primitives/scheduled';
import type { Accessor, JSX, Setter } from 'solid-js';
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  onMount,
  Show,
  useContext,
} from 'solid-js';
import {
  SplitBackButton,
  SplitCloseButton,
  SplitCreateButton,
  SplitForwardButton,
} from '../../../app/component/split-layout/SplitButtons';

false && observedSize;

type BarContext = {
  barSize: Accessor<DOMRect | undefined>;
  setBarSize: Setter<DOMRect | undefined>;
  leftSize: Accessor<DOMRect | undefined>;
  setLeftSize: Setter<DOMRect | undefined>;
  leftInitialized: Accessor<boolean>;
  setLeftInitialized: Setter<boolean>;
  centerSize: Accessor<DOMRect | undefined>;
  setCenterSize: Setter<DOMRect | undefined>;
  rightSize: Accessor<DOMRect | undefined>;
  setRightSize: Setter<DOMRect | undefined>;
  rightInitialized: Accessor<boolean>;
  setRightInitialized: Setter<boolean>;
  suppressPop: boolean | '' | null | undefined;
  truncation: Accessor<{ stage: TruncationStage; index: number }>;
};

export const BarContext = createContext<BarContext>();

export type TruncationStage = {
  fileNameLength: number;
  hideBreadcrumb?: boolean;
  hideLabels?: boolean;
  popCenter?: boolean;
  minimal?: boolean;
};

/**
 * Define levels of truncation for top bar.
 *
 * @example
 *
 * const context = useContext(BarContext);
  if (!context) throw new Error('FileMenu must be used within a Bar');
  const truncation = context.truncation;

  const truncatedName = createMemo(() => {
    const name = props.name;
    const maxLength = truncation().stage.fileNameLength;
    return truncate(name, maxLength);
  });
 *
 */
const TRUNCATION_STAGES: TruncationStage[] = [
  { fileNameLength: 35 }, // Stage 0: Full length
  { fileNameLength: 35, popCenter: true }, // Stage 1: Pop center
  { hideBreadcrumb: true, fileNameLength: 35, popCenter: true }, // Stage 2: Hide breadcrumb
  { hideBreadcrumb: true, fileNameLength: 24, popCenter: true }, // Stage 3: Short truncation
  {
    hideBreadcrumb: true,
    fileNameLength: 24,
    hideLabels: true,
    popCenter: true,
  }, // Stage 4: Hide labels
  {
    hideBreadcrumb: true,
    fileNameLength: 15,
    hideLabels: true,
    popCenter: true,
    minimal: true,
  }, // Stage 5: Emergency minimal
];

interface BarProps {
  left?: JSX.Element;
  center?: JSX.Element;
  right?: JSX.Element;
  hideCloseSplitButton?: boolean;
  suppressPop?: boolean | null | '';
}

export function Bar(props: BarProps) {
  const [barSize, setBarSize] = createSignal<DOMRect>();
  const [leftSize, setLeftSize] = createSignal<DOMRect>();
  const [leftInitialized, setLeftInitialized] = createSignal(false);
  const [centerSize, setCenterSize] = createSignal<DOMRect>();
  const [rightSize, setRightSize] = createSignal<DOMRect>();
  const [rightInitialized, setRightInitialized] = createSignal(false);
  const [currentStage, setCurrentStage] = createSignal(0);
  const [stageWidths, setStageWidths] = createSignal<(number | null)[]>(
    new Array(TRUNCATION_STAGES.length).fill(null)
  );

  const PADDING = 30;

  const overlap = createMemo(() => {
    if (currentStage() >= 1 && !props.suppressPop) {
      return (
        (barSize()?.width ?? 0) -
        ((leftSize()?.width ?? 0) + (rightSize()?.width ?? 0))
      );
    } else {
      return (
        (barSize()?.width ?? 0) -
        ((leftSize()?.width ?? 0) +
          (centerSize()?.width ?? 0) +
          (rightSize()?.width ?? 0))
      );
    }
  });

  const updateStage = (currentOverlap: number) => {
    // Checking for currentOverlap === 0 is a little hacky, but works to make sure we don't update the truncation stage before the bar is rendered, which Canvas causing to happen
    if (!leftInitialized() || !rightInitialized() || currentOverlap === 0) {
      return;
    }

    let currentWidth = 0;

    if (currentStage() === 0 || props.suppressPop) {
      currentWidth =
        (leftSize()?.width ?? 0) +
        (centerSize()?.width ?? 0) +
        (rightSize()?.width ?? 0);
    } else {
      currentWidth = (leftSize()?.width ?? 0) + (rightSize()?.width ?? 0);
    }

    // Store the current width measurement
    setStageWidths((prev) => {
      const next = [...prev];
      next[currentStage()] = currentWidth;
      return next;
    });

    // If we are out of room and we are at stage 0 and the pop IS NOT suppressed jump to stage 1
    if (
      currentOverlap < PADDING &&
      currentStage() === 0 &&
      !props.suppressPop
    ) {
      setCurrentStage(1);
    }

    // If we are out of room and we are at stage 0 and the pop IS suppressed, jump to stage 2
    else if (
      currentOverlap < PADDING &&
      currentStage() === 0 &&
      props.suppressPop
    ) {
      // Force set the stage width for stage 1
      setStageWidths((prev) => {
        const next = [...prev];
        next[1] = currentWidth;
        return next;
      });
      setCurrentStage(2);
    }

    // When contracting
    else if (
      currentOverlap < PADDING &&
      currentStage() < TRUNCATION_STAGES.length - 1
    ) {
      setCurrentStage((prev) =>
        Math.min(TRUNCATION_STAGES.length - 1, prev + 1)
      );
    }

    // When expanding
    else if (currentStage() > 0) {
      const prevStageWidth = stageWidths()[currentStage() - 1];
      // Only expand if we have have enough space for it
      if (
        prevStageWidth &&
        currentOverlap > prevStageWidth - currentWidth + PADDING
      ) {
        setCurrentStage((prev) => Math.max(0, prev - 1));
      }
    }
  };

  const throttledUpdateStage = throttle((currentOverlap: number) => {
    updateStage(currentOverlap);
  }, 100);

  createEffect(
    on([overlap], ([currentOverlap]) => {
      throttledUpdateStage(currentOverlap);
    })
  );

  createEffect(() => {
    if (overlap() < PADDING) {
      updateStage(overlap());
    }
  });

  // Hack to ensure stage gets set correctly at small widths
  onMount(() => {
    let attempts = 0;
    const maxAttempts = 4;
    const timeout = 300;

    function checkOverlap() {
      const currentOverlap = overlap();
      if (currentOverlap < 0) {
        throttledUpdateStage(currentOverlap);
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkOverlap, timeout);
      }
    }

    setTimeout(checkOverlap, timeout);
  });

  const truncation = createMemo(() => ({
    stage: TRUNCATION_STAGES[currentStage()],
    index: currentStage(),
  }));

  const context: BarContext = {
    barSize,
    setBarSize,
    leftSize,
    setLeftSize,
    leftInitialized,
    setLeftInitialized,
    centerSize,
    setCenterSize,
    rightSize,
    setRightSize,
    rightInitialized,
    setRightInitialized,
    suppressPop: props.suppressPop,
    truncation,
  };

  return (
    <BarContext.Provider value={context}>
      <BarContent {...props} />
    </BarContext.Provider>
  );
}

function BarContent(props: BarProps) {
  const context = useContext(BarContext);
  if (!context) throw new Error('BarContent must be used within Bar');
  const truncation = context.truncation;

  const isNestedBlock = isInBlock() && useIsNestedBlock();

  const leftComponent = createMemo(() => props.left);
  const centerComponent = createMemo(() => props.center);
  const rightComponent = createMemo(() => props.right);

  return (
    <Show when={!isNestedBlock}>
      <div
        use:observedSize={{ setSize: context.setBarSize }}
        style={{ 'container-type': 'inline-size' }}
        class="w-full bg-panel"
      >
        <div
          class={`group relative grid w-full justify-between items-center
        ${
          truncation().stage.popCenter && !context.suppressPop
            ? 'grid-cols-2 grid-rows-[auto_auto]'
            : 'grid-cols-[min-content_1fr_min-content]'
        }`}
        >
          <Show when={leftComponent()}>
            <div
              use:observedSize={{
                setSize: context.setLeftSize,
                setInitialized: context.setLeftInitialized,
              }}
              class={`pl-2 flex items-center justify-self-start col-start-1 row-start-1 border-b border-edge ${
                truncation().stage.popCenter && !context.suppressPop
                  ? 'w-full'
                  : 'w-fit'
              }`}
              style={{
                height: `${TOP_BAR_HEIGHT}px`,
              }}
            >
              <SplitCloseButton />
              <SplitBackButton />
              <SplitForwardButton />
              {leftComponent()}
            </div>
          </Show>

          <Show when={centerComponent()}>
            <div
              class={`flex justify-center items-center border-b border-edge
              ${
                truncation().stage.popCenter && !context.suppressPop
                  ? 'col-start-1 col-end-4 bg-edge/20 row-start-2 px-2 w-full'
                  : 'col-start-2 col-end-3 !row-start-1 bg-[revert] px-0'
              }`}
              style={{
                height: `${TOP_BAR_HEIGHT}px`,
              }}
            >
              <div
                use:observedSize={{ setSize: context.setCenterSize }}
                class="w-fit"
              >
                {centerComponent()}
              </div>
            </div>
          </Show>

          <div
            use:observedSize={{
              setSize: context.setRightSize,
              setInitialized: context.setRightInitialized,
            }}
            class={`justify-self-end flex justify-end items-center row-start-1 pr-2 border-b border-edge ${
              truncation().stage.popCenter && !context.suppressPop
                ? 'col-start-2 w-full'
                : 'col-start-3 w-fit'
            }`}
            style={{
              height: `${TOP_BAR_HEIGHT}px`,
            }}
          >
            <Show when={rightComponent()}>{rightComponent()}</Show>
            <SplitCreateButton />
          </div>
        </div>
      </div>
    </Show>
  );
}

import { getClippedOverlayRect } from '@app/util/getClippedOverlayRect';
import { getScrollElementParent } from '@app/util/getScrollElementParent';
import {
  isElementVisibleInScrollElViewport,
  isElementVisibleInViewport,
} from '@core/util/isElementVisibleInViewport';
import { autoUpdate } from '@floating-ui/dom';
import {
  type Accessor,
  type Component,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { tabbable } from 'tabbable';

type TJumpLabel = {
  id: string;
  label: string;
  originalLabel: string;
  active: boolean;
  targetEl: HTMLElement;
  targetElScrollParent: HTMLElement | null;
};

const componentStack: string[] = [];
const [triggerMacroJump, setTriggerMacroJump] = createSignal<Symbol>(Symbol());
export const fireMacroJump = () => {
  setTriggerMacroJump(Symbol());
};

const MacroJump: Component<{
  tabbableParent?: Accessor<Element | undefined>;
}> = (props) => {
  const componentId = createUniqueId();
  componentStack.push(componentId);
  const [jumpLabels, setJumpLabels] = createStore<TJumpLabel[]>([]);

  const removeAllOverlays = () => {
    setJumpLabels([]);
  };

  const filterOverlaysAndUpdateLabels = (input: string) => {
    const matchingLabels = jumpLabels.flatMap((item) => {
      const remainingPart = item.originalLabel.substring(input.length);
      return item.originalLabel.startsWith(input)
        ? [
            {
              ...item,
              label: remainingPart,
            },
          ]
        : [];
    });

    return matchingLabels;
  };

  const [currentInput, setCurrentInput] = createSignal('');

  const runMacroJump = () => {
    const root = props.tabbableParent?.() ?? document.getElementById('root')!;

    const tabbableEls = tabbable(root);

    const ignoreEls = [
      ...root.querySelectorAll(
        '[data-corvu-resizable-handle],[data-focus-trap]'
      ),
    ];

    const newJumpLabels: TJumpLabel[] = tabbableEls
      .filter((el) => {
        return (
          isElementVisibleInViewport(el as HTMLElement, {
            padding: {
              // include bottom navbar height to reduce viewport bottom
              // bottom: 32,
            },
          }) &&
          isElementVisibleInScrollElViewport(el as HTMLElement).isVisible &&
          !ignoreEls.includes(el)
        );
      })
      .map((tabbableEl) => {
        const id = createUniqueId();
        const jumpLetter = jump.getLabel();
        tabbableEl = tabbableEl as HTMLElement;
        const targetElScrollParent = getScrollElementParent(tabbableEl);

        return {
          id,
          active: true,
          label: jumpLetter,
          originalLabel: jumpLetter,
          targetEl: tabbableEl,
          targetElScrollParent,
        };
      });

    setJumpLabels(newJumpLabels);

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    // If user clicks anywhere, exit
    document.addEventListener(
      'mousedown',
      () => {
        runCleanup();
      },
      { once: true }
    );
  };

  const runCleanup = () => {
    jump.reset();
    setCurrentInput('');
    removeAllOverlays();
    window.removeEventListener('keydown', handleKeyDown, {
      capture: true,
    });
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    e.stopPropagation();
    e.preventDefault();

    if (e.key === 'Escape') {
      removeAllOverlays();
      window.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      });
      jump.reset();
      return;
    }

    if (e.key.length === 1 && /[a-zA-Z0-9;]/.test(e.key)) {
      setCurrentInput((prev) => prev + e.key.toLowerCase());
      const matchingLabels = filterOverlaysAndUpdateLabels(currentInput());

      if (matchingLabels.length === 1) {
        const targetElement = matchingLabels[0].targetEl;
        if (targetElement) {
          targetElement.focus();

          runCleanup();
          return;
        }
      }

      if (matchingLabels.length === 0) {
        runCleanup();
      } else {
        setJumpLabels(reconcile(matchingLabels));
      }

      return;
    }

    runCleanup();
  };

  createEffect(
    on(
      triggerMacroJump,
      () => {
        if (componentStack.at(-1) !== componentId) return;

        setCurrentInput('');
        setJumpLabels([]);

        runMacroJump();
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    componentStack.pop();
  });

  return (
    // <Portal mount={props.mount ?? document.getElementById('root')!}>
    <div>
      <For each={jumpLabels}>
        {(jumpLabel) => <JumpLabelOverlay {...jumpLabel} />}
      </For>
    </div>
    // </Portal>
  );
};

const JumpLabelOverlay: Component<TJumpLabel> = (props) => {
  const [targetData, setTargetData] = createStore({
    isClippedBottom: false,
    isClippedLeft: false,
    isClippedRight: false,
    isClippedTop: false,
  });
  let overlayRef!: HTMLDivElement;

  onMount(() => {
    const overlay = overlayRef;

    // Get the element's position and dimensions to check if it's visible
    const targetRect = props.targetEl.getBoundingClientRect();
    if (targetRect.width === 0 || targetRect.height === 0) return null;
    const {
      rect: clippedRect,
      isClippedBottom,
      isClippedLeft,
      isClippedRight,
      isClippedTop,
    } = getClippedOverlayRect(props.targetEl, props.targetElScrollParent);

    overlay.style.left = `${clippedRect.left}px`;
    overlay.style.top = `${clippedRect.top}px`;
    overlay.style.width = `${clippedRect.width}px`;
    overlay.style.height = `${clippedRect.height}px`;

    setTargetData({
      isClippedBottom,
      isClippedLeft,
      isClippedRight,
      isClippedTop,
    });

    const updateOverlay = async () => {
      const {
        rect: clippedRect,
        isFullyClipped,
        isClippedBottom,
        isClippedLeft,
        isClippedRight,
        isClippedTop,
      } = getClippedOverlayRect(props.targetEl, props.targetElScrollParent);

      overlay.style.display = isFullyClipped ? 'none' : 'block';
      overlay.style.left = `${clippedRect.left}px`;
      overlay.style.top = `${clippedRect.top}px`;
      overlay.style.width = `${clippedRect.width}px`;
      overlay.style.height = `${clippedRect.height}px`;

      setTargetData({
        isClippedBottom,
        isClippedLeft,
        isClippedRight,
        isClippedTop,
      });
    };
    const cleanup = autoUpdate(props.targetEl, overlayRef, updateOverlay);
    onCleanup(() => {
      cleanup();
    });
  });

  return (
    <div
      class={
        'highlight-overlay fixed pointer-events-none z-[9999] border-page  border'
      }
      style={{
        'border-left-width': targetData.isClippedLeft ? '0' : '',
        'border-top-width': targetData.isClippedTop ? '0' : '',
        'border-right-width': targetData.isClippedRight ? '0' : '',
        'border-bottom-width': targetData.isClippedBottom ? '0' : '',
      }}
      data-target-id={props.id}
      ref={overlayRef}
    >
      <div
        class="relative w-full h-full border-accent border"
        style={{
          'background-color':
            'color-mix(in srgb, var(--color-accent) 10%, transparent)',
          'border-left-width': targetData.isClippedLeft ? '0' : '',
          'border-top-width': targetData.isClippedTop ? '0' : '',
          'border-right-width': targetData.isClippedRight ? '0' : '',
          'border-bottom-width': targetData.isClippedBottom ? '0' : '',
        }}
      >
        <div
          class={
            'relative font-mono text-page font-bold w-fit bg-accent border-l-accent border-t-accent border-r-page border-b-page border p-[2px] text-xs z-[1]'
          }
        >
          {props.label}
        </div>
        <div
          class="absolute inset-0 border-page border"
          style={{
            'border-left-width': targetData.isClippedLeft ? '0' : '',
            'border-top-width': targetData.isClippedTop ? '0' : '',
            'border-right-width': targetData.isClippedRight ? '0' : '',
            'border-bottom-width': targetData.isClippedBottom ? '0' : '',
          }}
        />
      </div>
    </div>
  );
};

function createJumpLabelGenerator() {
  // Use 'asdfghjkl' for main characters and ';qwertyuiopzxcvbnm' for prefix characters
  const chars = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
  const prefixChars = [
    ';',
    'q',
    'w',
    'e',
    'r',
    't',
    'y',
    'u',
    'i',
    'o',
    'p',
    'z',
    'x',
    'c',
    'v',
    'b',
    'n',
    'm',
  ];

  return {
    getLabel(index: number) {
      if (index < chars.length) {
        // Single character labels
        return chars[index];
      } else {
        // Multi-character labels using prefix + character
        const remainder = index - chars.length;
        const currentStep = Math.floor(remainder / chars.length) + 1;

        if (currentStep > prefixChars.length) {
          return null; // No more labels available
        }

        const prefix = prefixChars[currentStep - 1];
        const label = chars[remainder % chars.length];

        // Avoid repeating the same character
        if (prefix === label) {
          // Calculate the next valid index that doesn't repeat characters
          const nextIndex = index + 1;
          return this.getLabel(nextIndex);
        }

        return prefix + label;
      }
    },

    // Better implementation that pre-calculates valid combinations
    createQueueBasedGenerator() {
      const queue = [...chars]; // Start with single-letter labels
      const seen = new Set(queue);

      return {
        getLabel(): string {
          // if (queue.length === 0) return null;
          const label = queue.shift();

          // Generate next level labels only when we're about to run out
          // This matches easymotion's approach of using prefix + character
          if (queue.length === 0) {
            for (let step = 1; step <= prefixChars.length; step++) {
              const prefix = prefixChars[step - 1];
              for (const c of chars) {
                const next = prefix + c;
                // Avoid repeating the same character and ensure it's not already seen
                if (prefix !== c && !seen.has(next)) {
                  queue.push(next);
                  seen.add(next);
                }
              }
            }
          }

          return label!;
        },

        reset() {
          queue.length = 0;
          seen.clear();
          for (const c of chars) {
            queue.push(c);
            seen.add(c);
          }
        },
      };
    },

    // Alternative implementation that directly calculates valid labels
    getLabelDirect(index: number) {
      if (index < chars.length) {
        return chars[index];
      }

      // For multi-character labels, we need to account for skipped combinations
      let validIndex = index - chars.length;
      let currentStep = 1;

      while (currentStep <= prefixChars.length) {
        const prefix = prefixChars[currentStep - 1];
        const validCharsInStep = chars.filter((c) => c !== prefix);
        const stepSize = validCharsInStep.length;

        if (validIndex < stepSize) {
          return prefix + validCharsInStep[validIndex];
        }

        validIndex -= stepSize;
        currentStep++;
      }

      return null; // No more labels available
    },

    // Reset method for the main generator
    reset() {
      // This resets any internal state if needed
      // For the index-based approach, no state to reset
      // For queue-based generators, they have their own reset methods
      return this;
    },
  };
}
const jump = createJumpLabelGenerator().createQueueBasedGenerator();

export default MacroJump;

import { createEffect, createSignal, onCleanup } from 'solid-js';

const DEFAULT_GLITCH_CHARACTERS = '!@#$%^&*()_+-=[]{}|;\':",./<>?';
const DEFAULT_CONFIG = {
  chars: DEFAULT_GLITCH_CHARACTERS,
  cycles: 2,
  framerate: 12,
  delay: 1000,
} as const;

const getRandomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const getRandomCharacter = (characters: string[]): string =>
  characters[getRandomInt(0, characters.length - 1)];

const generateRandomString = (length: number, characters: string[]): string =>
  Array.from({ length }, () => getRandomCharacter(characters)).join('');

const shuffleIndices = (indices: number[]): number[] => {
  const shuffled = [...indices];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const isUserProvidedText = (
  text: string,
  fromProp?: string,
  toProp?: string
): boolean => {
  return text === fromProp || text === toProp;
};

enum AnimationPhase {
  Corrupting = 0,
  Decoding = 1,
}

interface AnimationConfig {
  sourceText: string;
  targetText: string;
  glitchCharacters: string[];
  cycleCount: number;
  frameRate: number;
  maxDisplayLength: number;
  clearTextDelay: number;
  updateDisplay: (chars: string[]) => void;
  onAnimationComplete: () => void;
  preserveCurrentState?: boolean;
  fromProp?: string;
  toProp?: string;
}

function createGlitchAnimation(config: AnimationConfig): () => void {
  const {
    sourceText,
    targetText,
    glitchCharacters,
    cycleCount,
    frameRate,
    maxDisplayLength,
    clearTextDelay,
    updateDisplay,
    onAnimationComplete,
    preserveCurrentState = false,
    fromProp,
    toProp,
  } = config;

  // Setup padded text arrays for consistent display width
  const displayLength =
    maxDisplayLength || Math.max(sourceText.length, targetText.length);
  const finalTargetChars = targetText.padEnd(displayLength, ' ').split('');
  let displayChars = sourceText.padEnd(displayLength, ' ').split('');

  // Pre-compute animatable character positions (exclude positions that are spaces in both strings)
  const animatableIndices = displayChars
    .map((_, index) => index)
    .filter(
      (i) =>
        sourceText.padEnd(displayLength, ' ')[i] !== ' ' ||
        targetText.padEnd(displayLength, ' ')[i] !== ' '
    );

  // Pre-shuffle processing orders for visual randomness
  const corruptionOrder = shuffleIndices(animatableIndices);
  const decodingOrder = shuffleIndices(animatableIndices);

  // Animation state management
  let animationFrameId: number | undefined;
  let lastTimestamp = 0;
  let currentPhase = AnimationPhase.Corrupting;
  let completedCycles = 0;
  let processedCharacterIndex = 0;
  let delayStartTimestamp = 0;
  let isWaitingForDelay = false;

  const millisecondsPerFrame = 1000 / (frameRate || DEFAULT_CONFIG.framerate);

  // Initialize display state
  if (!preserveCurrentState) {
    updateDisplay([...displayChars]);
  }

  const processAnimationFrame = (timestamp: number): void => {
    // Handle clear text delay period
    if (isWaitingForDelay) {
      if (timestamp - delayStartTimestamp >= clearTextDelay) {
        onAnimationComplete();
        return;
      }
      animationFrameId = requestAnimationFrame(processAnimationFrame);
      return;
    }

    // Enforce frame rate limiting
    if (timestamp - lastTimestamp < millisecondsPerFrame) {
      animationFrameId = requestAnimationFrame(processAnimationFrame);
      return;
    }
    lastTimestamp = timestamp;

    // Get processing order and target character for current phase
    const processingOrder =
      currentPhase === AnimationPhase.Corrupting
        ? corruptionOrder
        : decodingOrder;
    const characterPosition =
      processingOrder[processedCharacterIndex % processingOrder.length];

    // Apply character transformation based on current phase
    if (currentPhase === AnimationPhase.Corrupting) {
      displayChars[characterPosition] = getRandomCharacter(glitchCharacters);
    } else {
      displayChars[characterPosition] = finalTargetChars[characterPosition];
    }

    updateDisplay([...displayChars]);
    processedCharacterIndex++;

    // Check for cycle completion
    if (processedCharacterIndex >= processingOrder.length) {
      completedCycles++;
      processedCharacterIndex = 0;

      if (completedCycles >= cycleCount) {
        if (currentPhase === AnimationPhase.Corrupting) {
          currentPhase = AnimationPhase.Decoding;
          completedCycles = 0;
        } else {
          // Animation sequence complete - finalize display and handle delay
          displayChars = [...finalTargetChars];
          updateDisplay([...displayChars]);

          const shouldPauseOnTarget =
            clearTextDelay > 0 &&
            isUserProvidedText(targetText, fromProp, toProp);
          if (shouldPauseOnTarget) {
            isWaitingForDelay = true;
            delayStartTimestamp = timestamp;
            animationFrameId = requestAnimationFrame(processAnimationFrame);
            return;
          } else {
            onAnimationComplete();
            return;
          }
        }
      }
    }

    animationFrameId = requestAnimationFrame(processAnimationFrame);
  };

  animationFrameId = requestAnimationFrame(processAnimationFrame);
  return () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
  };
}

export interface GlitchTextProps {
  /** Source text to animate from. If only `from` provided, corrupts then randomizes. @default undefined */
  from?: string;

  /** Target text to animate to. If only `to` provided, decodes from random glitch. @default undefined */
  to?: string;

  /** Cycle animation continuously between `from` and `to` @default false */
  continuous?: boolean;

  /** Characters used for glitch effect during corruption phase. @default "!@#$%^&*()_+-=[]{}|;':\",./<>?" @example "01" */
  chars?: string;

  /** Number of times each character should change before completing from->to. @default 2 */
  cycles?: number;

  /** Animation frame rate in FPS. Higher = faster but more CPU intensive. @default 12 */
  framerate?: number;

  /** Pause duration in milliseconds when displaying clear text. @default 1000 */
  delay?: number;

  /** Callback when animation completes. Only fires in non-continuous mode. @default undefined */
  onComplete?: () => void;

  /** CSS classes to apply to the span element. @default undefined @example "font-mono text-success" */
  class?: string;
}

/**
 * Glitch text transitions.
 *
 * @example
 * ```tsx
 * <GlitchText from="Hello World" /> // Basic corruption effect
 * <GlitchText to="Welcome!" /> // Decode effect
 *
 * // Transform between two texts
 * <GlitchText from="Loading..." to="Complete!" />
 *
 * // Continuous oscillating animation
 * <GlitchText
 *   from="Hello World"
 *   to="Nice to meet you"
 *   continuous
 *   cycles={2}
 *   framerate={60}
 *   delay={200}
 * />
 *
 * // Custom glitch characters
 * <GlitchText
 *   from="Blocks"
 *   to="Cool"
 *   chars="█▓▒░"
 *   class="font-mono text-accent"
 * />
 * ```
 */
export function GlitchText(props: GlitchTextProps) {
  const [displayedCharacters, setDisplayedCharacters] = createSignal<string[]>(
    []
  );

  let animationCleanup: (() => void) | undefined;
  let initialDelayTimeoutId: number | undefined;
  let sourceText = '';
  let targetText = '';
  let maxTextLength = 0;

  const startAnimationSequence = (
    from: string,
    to: string,
    isInitialRun = true
  ) => {
    // Clean up any existing animation resources
    if (animationCleanup) animationCleanup();
    if (initialDelayTimeoutId) clearTimeout(initialDelayTimeoutId);

    // Show clear source text only on initial animation (not during continuous cycles)
    if (isInitialRun) {
      setDisplayedCharacters(from.padEnd(maxTextLength, ' ').split(''));
    }

    const beginGlitchTransition = () => {
      animationCleanup = createGlitchAnimation({
        sourceText: from,
        targetText: to,
        glitchCharacters: (props.chars ?? DEFAULT_CONFIG.chars).split(''),
        cycleCount: props.cycles ?? DEFAULT_CONFIG.cycles,
        frameRate: props.framerate || DEFAULT_CONFIG.framerate,
        maxDisplayLength: maxTextLength,
        clearTextDelay: props.delay ?? DEFAULT_CONFIG.delay,
        updateDisplay: setDisplayedCharacters,
        onAnimationComplete: () => {
          if (props.continuous) {
            // Swap source and target for continuous oscillation
            [sourceText, targetText] = [targetText, sourceText];
            startAnimationSequence(sourceText, targetText, false);
          } else {
            props.onComplete?.();
          }
        },
        preserveCurrentState: !isInitialRun,
        fromProp: props.from,
        toProp: props.to,
      });
    };

    // Apply initial delay only if the source text is user-provided
    const shouldPauseOnSource = isUserProvidedText(from, props.from, props.to);
    const initialDelay = props.delay ?? DEFAULT_CONFIG.delay;
    if (isInitialRun && initialDelay > 0 && shouldPauseOnSource) {
      initialDelayTimeoutId = window.setTimeout(
        beginGlitchTransition,
        initialDelay
      );
    } else {
      beginGlitchTransition();
    }
  };

  createEffect(() => {
    // Require at least one text prop to animate
    if (!props.from && !props.to) {
      if (animationCleanup) animationCleanup();
      console.error('GlitchText needs props.from or props.to to render!');
      return;
    }

    const glitchCharacters = (props.chars ?? DEFAULT_CONFIG.chars).split('');

    if (props.from && !props.to) {
      // from only: from → glitch → random
      sourceText = props.from;
      targetText = generateRandomString(props.from.length, glitchCharacters);
    } else if (!props.from && props.to) {
      // to only: random → glitch → to
      sourceText = generateRandomString(props.to.length, glitchCharacters);
      targetText = props.to;
    } else if (props.from && props.to) {
      // from + to: from → glitch → to
      sourceText = props.from;
      targetText = props.to;
    }

    // Calculate consistent display width to prevent visual jumping
    maxTextLength = Math.max(sourceText.length, targetText.length);
    startAnimationSequence(sourceText, targetText, true);
  });

  onCleanup(() => {
    if (animationCleanup) animationCleanup();
    if (initialDelayTimeoutId) clearTimeout(initialDelayTimeoutId);
  });

  return <span class={props.class}>{displayedCharacters().join('')}</span>;
}

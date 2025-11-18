import { GlitchText } from '@core/component/GlitchText';
import { useSettingsState } from '@core/constant/SettingsState';
import { useBigChat } from '@core/signal/layout/bigChat';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { setKonsoleMode, setKonsoleOpen } from '../command/state';
import { setCreateMenuOpen } from '../Launcher';

type HintItem = {
  text: string;
  onClick?: () => void;
};

type HintState = 'hidden' | 'animating' | 'visible' | 'fading' | 'grace-period';

const FADE_DELAY = 1000;
const GRACE_PERIOD = 3000; // 3 seconds to interact with completed hint

export default function Hints() {
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const { toggleSettings, setActiveTabId } = useSettingsState();

  const HINT_LIST: HintItem[] = [
    {
      text: 'Use ⌘K to find anything instantly',
      onClick: () => setKonsoleOpen(true),
    },
    {
      text: '⌘P for full text search',
      onClick: () => {
        setKonsoleMode('FULL_TEXT_SEARCH');
        setKonsoleOpen(true);
      },
    },
    { text: 'Bigger screens can fit more splits' },
    { text: 'Make today your mission' },
    {
      text: 'Hit C to create anything',
      onClick: () => setCreateMenuOpen(true),
    },
    {
      text: 'You can customize your color scheme in settings',
      onClick: () => {
        toggleSettings();
        setActiveTabId('Appearance');
      },
    },
    { text: 'Fake User is a real person' },
    {
      text: '40.7411857, -73.9957703',
      onClick: () =>
        window.open(
          'https://www.google.com/maps/place/54+W+21st+St+s503,+New+York,+NY+10010/@40.7411857,-73.9957703,17z',
          '_blank'
        ),
    },
    {
      text: 'market.macro.com',
      onClick: () => window.open('https://market.macro.com', '_blank'),
    },
    {
      text: 'alt-click will open items in a new split',
    },
    {
      text: '⌘J to ask AI something quickly',
      onClick: () => setBigChatOpen(!bigChatOpen()),
    },
  ];

  // State management
  const [hintState, setHintState] = createSignal<HintState>('hidden');
  const [isHovered, setIsHovered] = createSignal(false);
  const [currentHintText, setCurrentHintText] = createSignal<string>('');
  const [recentHints, setRecentHints] = createSignal<number[]>([]);

  let fadeTimeoutId: number | undefined;
  let gracePeriodStart: number | null = null;

  // Computed values for derived state
  const isAnimating = createMemo(() => hintState() === 'animating');
  const shouldShow = createMemo(() => hintState() !== 'hidden');
  const isClickable = createMemo(() => {
    const recent = recentHints();
    const currentHintIndex = recent[0];
    return (
      currentHintIndex !== undefined && HINT_LIST[currentHintIndex]?.onClick
    );
  });
  const withinGracePeriod = createMemo(() => {
    return (
      gracePeriodStart !== null && Date.now() - gracePeriodStart < GRACE_PERIOD
    );
  });

  const clearFadeTimeout = () => {
    if (fadeTimeoutId !== undefined) window.clearTimeout(fadeTimeoutId);
  };

  const handleGlitchComplete = () => {
    setHintState('visible');
    gracePeriodStart = Date.now();

    // Start fade-out timer only if not hovering
    if (!isHovered()) {
      fadeTimeoutId = window.setTimeout(() => {
        if (!isHovered()) {
          // Start CSS fade transition
          setHintState('fading');
          // After CSS transition completes (2s), set to hidden
          fadeTimeoutId = window.setTimeout(() => {
            setHintState('hidden');
          }, 2000); // Match CSS transition duration
        }
      }, FADE_DELAY);
    }
  };

  const startNewHint = (forceIndex?: number) => {
    clearFadeTimeout();

    let hintIndex: number;
    if (forceIndex !== undefined) {
      hintIndex = forceIndex;
    } else {
      // Get available hints (excluding recent 3)
      const recent = recentHints();
      const availableIndices = HINT_LIST.map((_, i) => i).filter(
        (i) => !recent.includes(i)
      );

      // If no available hints (edge case), use any hint
      if (availableIndices.length === 0) {
        hintIndex = Math.floor(Math.random() * HINT_LIST.length);
      } else {
        hintIndex =
          availableIndices[Math.floor(Math.random() * availableIndices.length)];
      }
    }

    // Update recent hints history (keep last 3)
    setRecentHints((prev) => [hintIndex, ...prev.slice(0, 2)]);

    const hint = HINT_LIST[hintIndex].text;

    gracePeriodStart = null; // Reset grace period
    setCurrentHintText(hint);
    setHintState('animating');
  };

  const handleMouseEnter = () => {
    setIsHovered(true);

    // If currently animating, let it finish
    if (isAnimating()) {
      return;
    }

    // If hint is already visible, keep it visible and cancel any fade timers
    if (hintState() === 'visible') {
      clearFadeTimeout();
      return;
    }

    // If fading or within grace period, restore current hint (don't change text!)
    if (hintState() === 'fading' || withinGracePeriod()) {
      clearFadeTimeout();
      setHintState('visible');
      return;
    }

    // Only start new hint if we're in hidden state AND not in grace period
    if (hintState() === 'hidden' && !withinGracePeriod()) {
      startNewHint();
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);

    // If hint is visible, start fade timer
    if (hintState() === 'visible') {
      clearFadeTimeout(); // Cancel any existing timer
      fadeTimeoutId = window.setTimeout(() => {
        if (!isHovered()) {
          // Start CSS fade transition
          setHintState('fading');
          // After CSS transition completes (2s), set to hidden
          fadeTimeoutId = window.setTimeout(() => {
            setHintState('hidden');
          }, 2000); // Match CSS transition duration
        }
      }, FADE_DELAY);
    }
  };

  const handleClick = () => {
    const recent = recentHints();
    const currentHintIndex = recent[0];

    if (currentHintIndex !== undefined) {
      const currentHint = HINT_LIST[currentHintIndex];

      // Only handle click if there's an onClick function
      if (currentHint.onClick) {
        currentHint.onClick();
      }
    }
  };

  onMount(() => {
    // Auto-trigger first hint on mount
    startNewHint(0);
  });

  onCleanup(() => {
    clearFadeTimeout();
  });

  return (
    <p
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      class="flex flex-1 justify-center items-center w-full h-full font-mono text-center transition duration-[2s]"
      classList={{
        'opacity-100': shouldShow(),
        'opacity-0': !shouldShow(),
        'cursor-pointer hover:text-glow hover:text-accent transition duration-300':
          !!isClickable(),
      }}
    >
      <GlitchText
        to={currentHintText()}
        framerate={60}
        cycles={1}
        onComplete={handleGlitchComplete}
      />
    </p>
  );
}

import { createSignal, For, onCleanup, onMount, type ParentComponent, Show } from 'solid-js';

// Local storage key for persisting bezel visibility
const BEZEL_HIDDEN_KEY = 'macro-tutorial-bezel-hidden';

const getInitialHiddenState = () => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(BEZEL_HIDDEN_KEY) === 'true';
};

export const [isBezelHidden, setIsBezelHidden] = createSignal(getInitialHiddenState());

export const hideBezel = () => {
  setIsBezelHidden(true);
  localStorage.setItem(BEZEL_HIDDEN_KEY, 'true');
};

export const showBezel = () => {
  setIsBezelHidden(false);
  localStorage.removeItem(BEZEL_HIDDEN_KEY);
};

// Current tutorial being shown
const [activeTutorial, setActiveTutorial] = createSignal<string | null>(null);

// Feature tutorial content
type FeatureTutorial = {
  key: string;
  label: string;
  title: string;
  description: string;
  steps: string[];
  tip: string;
};

const featureTutorials: FeatureTutorial[] = [
  {
    key: 'N',
    label: 'Note',
    title: 'Notes',
    description: 'Quick capture for your thoughts, meeting notes, and ideas.',
    steps: [
      'Press N to create a new note instantly',
      'Use markdown formatting for rich text',
      'Notes auto-save as you type',
      'Link notes to emails, tasks, or people with @mentions',
    ],
    tip: 'Pro tip: Start a note with # to create a heading, or - to create a bullet list.',
  },
  {
    key: 'T',
    label: 'Task',
    title: 'Tasks',
    description: 'Track your to-dos and action items in one place.',
    steps: [
      'Press T to create a new task',
      'Set due dates, priorities, and assignees',
      'Tasks can be linked to emails or notes',
      'Mark complete with Enter or click the checkbox',
    ],
    tip: 'Pro tip: Create tasks from emails by pressing T while viewing a message.',
  },
  {
    key: 'E',
    label: 'Email',
    title: 'Email',
    description: 'Compose and send emails without leaving Macro.',
    steps: [
      'Press E to compose a new email',
      'Use @ to mention contacts from your address book',
      'Attach files by dragging or pressing A',
      'Schedule send with the clock icon',
    ],
    tip: 'Pro tip: Reply to any email thread by pressing R while it\'s selected.',
  },
  {
    key: 'M',
    label: 'Message',
    title: 'Messages',
    description: 'Quick internal messages to your team.',
    steps: [
      'Press M to start a new message',
      'Messages are instant and conversational',
      'Create group chats or 1:1 conversations',
      'React with emoji or reply in threads',
    ],
    tip: 'Pro tip: Use /commands in messages for quick actions like /task or /remind.',
  },
  {
    key: 'A',
    label: 'AI',
    title: 'AI Assistant',
    description: 'Your intelligent assistant for writing, summarizing, and more.',
    steps: [
      'Press A to open the AI assistant',
      'Ask questions about your documents and emails',
      'Generate drafts, summaries, and action items',
      'AI learns your writing style over time',
    ],
    tip: 'Pro tip: Select text and press A to get AI help with just that selection.',
  },
  {
    key: 'D',
    label: 'Canvas',
    title: 'Canvas',
    description: 'Visual workspace for brainstorming and collaboration.',
    steps: [
      'Press D to create a new canvas',
      'Drag and drop notes, images, and files',
      'Draw freehand or add shapes',
      'Collaborate in real-time with your team',
    ],
    tip: 'Pro tip: Double-click anywhere on the canvas to add a sticky note.',
  },
  {
    key: 'F',
    label: 'Folder',
    title: 'Folders',
    description: 'Organize your work into projects and spaces.',
    steps: [
      'Press F to create a new folder',
      'Drag items into folders to organize them',
      'Share folders with team members',
      'Set folder-level permissions and defaults',
    ],
    tip: 'Pro tip: Pin frequently used folders to your sidebar for quick access.',
  },
  {
    key: 'O',
    label: 'Code',
    title: 'Code Snippets',
    description: 'Save, share, and syntax-highlight code.',
    steps: [
      'Press O to create a new code snippet',
      'Supports 100+ programming languages',
      'Syntax highlighting and line numbers included',
      'Share snippets with a link or embed in notes',
    ],
    tip: 'Pro tip: Paste code from your clipboard and Macro will auto-detect the language.',
  },
];

// CSS for badges and tutorial overlay
const tutorialStyles = `
  .tutorial-key-badge {
    background: linear-gradient(180deg, hsl(200 15% 18%) 0%, hsl(200 15% 12%) 100%);
    border: 1px solid hsl(145 60% 40% / 0.4);
    border-radius: 4px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 8px hsl(145 60% 50% / 0.2), 0 2px 4px rgba(0, 0, 0, 0.4);
    color: hsl(145 70% 60%);
    text-shadow: 0 0 8px hsl(145 70% 50% / 0.6);
    transform: scale(1);
    transition: all 75ms ease-out;
  }
  .tutorial-key-badge.pressed {
    background: linear-gradient(180deg, hsl(145 40% 25%) 0%, hsl(145 40% 18%) 100%);
    border: 1px solid hsl(145 70% 50% / 0.8);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15), 0 0 20px hsl(145 70% 50% / 0.6), 0 0 40px hsl(145 70% 50% / 0.3), 0 2px 4px rgba(0, 0, 0, 0.4);
    color: hsl(145 80% 75%);
    text-shadow: 0 0 12px hsl(145 80% 50% / 0.9);
    transform: scale(1.08);
  }
  .tutorial-key-label {
    color: hsl(200 20% 60%);
    transition: color 75ms ease-out;
  }
  .tutorial-key-label.pressed {
    color: hsl(145 60% 70%);
  }
  .tutorial-feature-badge {
    background: linear-gradient(180deg, hsl(200 15% 18%) 0%, hsl(200 15% 12%) 100%);
    border: 1px solid hsl(280 60% 50% / 0.4);
    border-radius: 4px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 8px hsl(280 60% 50% / 0.2), 0 2px 4px rgba(0, 0, 0, 0.4);
    color: hsl(280 70% 70%);
    text-shadow: 0 0 8px hsl(280 70% 50% / 0.6);
    transform: scale(1);
    transition: all 100ms ease-out;
    cursor: pointer;
  }
  .tutorial-feature-badge:hover {
    background: linear-gradient(180deg, hsl(280 30% 22%) 0%, hsl(280 30% 16%) 100%);
    border: 1px solid hsl(280 70% 55% / 0.6);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 14px hsl(280 70% 50% / 0.35), 0 2px 4px rgba(0, 0, 0, 0.4);
    color: hsl(280 80% 80%);
    text-shadow: 0 0 10px hsl(280 80% 50% / 0.8);
    transform: scale(1.05);
  }
  .tutorial-feature-badge:active {
    transform: scale(0.98);
  }
  .tutorial-feature-label {
    color: hsl(200 20% 55%);
    transition: color 100ms ease-out;
  }
  .tutorial-feature-badge:hover + .tutorial-feature-label {
    color: hsl(280 60% 75%);
  }
  .tutorial-overlay {
    animation: tutorial-fade-in 200ms ease-out;
  }
  .tutorial-card {
    animation: tutorial-slide-up 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes tutorial-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes tutorial-slide-up {
    from { 
      opacity: 0;
      transform: translateY(20px) scale(0.95);
    }
    to { 
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

// Map keyboard keys to their data-key attribute values
const keyMap: Record<string, string> = {
  j: 'j',
  k: 'k',
  p: 'p',
  enter: 'enter',
};

const KeyBadge = (props: { keyLabel: string; description: string; keyCode: string }) => {
  return (
    <div class="flex items-center gap-2">
      <div
        class="tutorial-key-badge relative min-w-[1.75rem] h-7 px-1.5 flex items-center justify-center font-mono text-xs font-bold tracking-wide uppercase"
        data-key={props.keyCode}
      >
        {props.keyLabel}
      </div>
      <span
        class="tutorial-key-label text-[10px] font-medium tracking-wider uppercase"
        data-key-label={props.keyCode}
      >
        {props.description}
      </span>
    </div>
  );
};

const FeatureBadge = (props: { keyLabel: string; description: string; onClick: () => void }) => {
  return (
    <button class="flex items-center gap-1.5 group" onClick={props.onClick}>
      <div class="tutorial-feature-badge relative min-w-[1.75rem] h-7 px-1.5 flex items-center justify-center font-mono text-xs font-bold tracking-wide uppercase">
        {props.keyLabel}
      </div>
      <span class="tutorial-feature-label text-[10px] font-medium tracking-wider uppercase group-hover:text-[hsl(280_60%_75%)] transition-colors">
        {props.description}
      </span>
    </button>
  );
};

// Tutorial Overlay Component
const TutorialOverlay = (props: { tutorial: FeatureTutorial; onClose: () => void }) => {
  // Close on Escape key
  onMount(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', handleEscape);
    onCleanup(() => window.removeEventListener('keydown', handleEscape));
  });

  return (
    <div
      class="tutorial-overlay fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(0, 0, 0, 0.8)',
        'backdrop-filter': 'blur(4px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="tutorial-card relative max-w-lg w-full mx-4"
        style={{
          background: `linear-gradient(
            180deg,
            hsl(200 10% 16%) 0%,
            hsl(200 10% 12%) 100%
          )`,
          border: '1px solid hsl(280 60% 50% / 0.4)',
          'border-radius': '12px',
          'box-shadow': `
            0 0 40px hsl(280 60% 50% / 0.2),
            0 20px 60px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 rgba(255, 255, 255, 0.08)
          `,
        }}
      >
        {/* Header */}
        <div
          class="flex items-center justify-between px-6 py-4"
          style={{
            'border-bottom': '1px solid hsl(280 50% 40% / 0.3)',
          }}
        >
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 flex items-center justify-center font-mono text-lg font-bold"
              style={{
                background: 'linear-gradient(180deg, hsl(280 40% 25%) 0%, hsl(280 40% 18%) 100%)',
                border: '1px solid hsl(280 70% 55% / 0.5)',
                'border-radius': '8px',
                color: 'hsl(280 80% 80%)',
                'text-shadow': '0 0 12px hsl(280 80% 50% / 0.8)',
                'box-shadow': '0 0 16px hsl(280 70% 50% / 0.3)',
              }}
            >
              {props.tutorial.key}
            </div>
            <div>
              <h2
                class="text-lg font-bold"
                style={{
                  color: 'hsl(280 70% 80%)',
                  'text-shadow': '0 0 20px hsl(280 70% 50% / 0.5)',
                }}
              >
                {props.tutorial.title}
              </h2>
              <p class="text-xs text-[hsl(200_20%_60%)]">Press {props.tutorial.key} to create</p>
            </div>
          </div>
          <button
            onClick={props.onClose}
            class="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:bg-white/10"
            style={{ color: 'hsl(200 20% 60%)' }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div class="px-6 py-5">
          <p class="text-sm text-[hsl(200_20%_70%)] mb-5">{props.tutorial.description}</p>

          {/* Steps */}
          <div class="space-y-3 mb-5">
            <For each={props.tutorial.steps}>
              {(step, index) => (
                <div class="flex items-start gap-3">
                  <div
                    class="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5"
                    style={{
                      background: 'hsl(280 40% 20%)',
                      border: '1px solid hsl(280 60% 50% / 0.4)',
                      color: 'hsl(280 70% 70%)',
                    }}
                  >
                    {index() + 1}
                  </div>
                  <p class="text-sm text-[hsl(200_15%_75%)]">{step}</p>
                </div>
              )}
            </For>
          </div>

          {/* Tip */}
          <div
            class="p-3 rounded-lg"
            style={{
              background: 'hsl(145 40% 12%)',
              border: '1px solid hsl(145 60% 40% / 0.3)',
            }}
          >
            <p class="text-xs" style={{ color: 'hsl(145 70% 65%)' }}>
              💡 {props.tutorial.tip}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          class="flex justify-end px-6 py-4"
          style={{
            'border-top': '1px solid hsl(280 50% 40% / 0.2)',
          }}
        >
          <button
            onClick={props.onClose}
            class="px-5 py-2 text-xs font-bold uppercase tracking-widest transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(180deg, hsl(280 40% 25%) 0%, hsl(280 40% 18%) 100%)',
              border: '1px solid hsl(280 60% 50% / 0.4)',
              'border-radius': '6px',
              'box-shadow': '0 0 12px hsl(280 60% 50% / 0.2), 0 2px 4px rgba(0, 0, 0, 0.3)',
              color: 'hsl(280 70% 75%)',
            }}
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

const DismissButton = (props: { onClick: () => void }) => {
  return (
    <button
      onClick={props.onClick}
      class="group relative px-5 py-2 text-xs font-bold uppercase tracking-widest transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
      style={{
        background: `linear-gradient(
          180deg,
          hsl(200 15% 20%) 0%,
          hsl(200 15% 14%) 100%
        )`,
        border: '1px solid hsl(145 60% 40% / 0.3)',
        'border-radius': '4px',
        'box-shadow': `
          inset 0 1px 0 rgba(255, 255, 255, 0.08),
          0 0 12px hsl(145 60% 50% / 0.15),
          0 2px 4px rgba(0, 0, 0, 0.3)
        `,
        color: 'hsl(145 50% 55%)',
      }}
    >
      <span class="relative z-10 group-hover:text-[hsl(145_70%_65%)] transition-colors">
        I know what I'm doing
      </span>
    </button>
  );
};

// Decorative LED indicator
const LedIndicator = (props: { class?: string }) => {
  return (
    <div
      class={`w-2 h-2 rounded-full ${props.class ?? ''}`}
      style={{
        background: `hsl(145 70% 50%)`,
        'box-shadow': `
          0 0 6px hsl(145 70% 50%),
          0 0 12px hsl(145 70% 50% / 0.5),
          inset 0 -1px 2px rgba(0, 0, 0, 0.3)
        `,
      }}
    />
  );
};

// Decorative screw for metallic look
const Screw = (props: { class?: string }) => {
  return (
    <div
      class={`w-3 h-3 rounded-full relative ${props.class ?? ''}`}
      style={{
        background: `radial-gradient(
          circle at 30% 30%,
          hsl(200 10% 45%) 0%,
          hsl(200 10% 30%) 50%,
          hsl(200 10% 22%) 100%
        )`,
        'box-shadow': `
          inset 1px 1px 2px rgba(255, 255, 255, 0.2),
          inset -1px -1px 2px rgba(0, 0, 0, 0.4),
          0 1px 2px rgba(0, 0, 0, 0.3)
        `,
      }}
    >
      <div
        class="absolute inset-0.5 rounded-full"
        style={{
          background: `linear-gradient(
            135deg,
            transparent 35%,
            rgba(0, 0, 0, 0.3) 50%,
            transparent 65%
          )`,
        }}
      />
    </div>
  );
};

// Decorative vent slots for metallic look
const VentSlots = () => {
  return (
    <div class="flex gap-0.5">
      {Array.from({ length: 5 }).map(() => (
        <div
          class="w-0.5 h-4 rounded-full"
          style={{
            background: `linear-gradient(
              180deg,
              hsl(200 10% 8%) 0%,
              hsl(200 10% 5%) 100%
            )`,
            'box-shadow': `
              inset 0 1px 1px rgba(0, 0, 0, 0.8),
              0 1px 0 rgba(255, 255, 255, 0.08)
            `,
          }}
        />
      ))}
    </div>
  );
};

export const TutorialBezel: ParentComponent = (props) => {
  // Set up keyboard event listeners for the glow effect using DOM manipulation
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mappedKey = keyMap[key];
      if (mappedKey) {
        const badge = document.querySelector(`.tutorial-key-badge[data-key="${mappedKey}"]`);
        const label = document.querySelector(`.tutorial-key-label[data-key-label="${mappedKey}"]`);
        badge?.classList.add('pressed');
        label?.classList.add('pressed');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mappedKey = keyMap[key];
      if (mappedKey) {
        const badge = document.querySelector(`.tutorial-key-badge[data-key="${mappedKey}"]`);
        const label = document.querySelector(`.tutorial-key-label[data-key-label="${mappedKey}"]`);
        badge?.classList.remove('pressed');
        label?.classList.remove('pressed');
      }
    };

    // Use capture phase to get events before they're handled elsewhere
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
    });
  });

  return (
    <Show when={!isBezelHidden()} fallback={props.children}>
      {/* CSS variables for bezel dimensions and styles */}
      <style>{`
        .tutorial-bezel-container {
          --bezel-top: 44px;
          --bezel-side: 12px;
          --bezel-bottom: 100px;
        }
        ${tutorialStyles}
      `}</style>

      {/* Tutorial Overlay */}
      <Show when={activeTutorial()}>
        {(tutorialKey) => {
          const tutorial = featureTutorials.find((t) => t.key === tutorialKey());
          return tutorial ? (
            <TutorialOverlay tutorial={tutorial} onClose={() => setActiveTutorial(null)} />
          ) : null;
        }}
      </Show>
      
      <div class="tutorial-bezel-container w-dvw h-dvh relative overflow-hidden bg-[hsl(200_10%_10%)]">
        {/* Top bezel - metallic */}
        <div
          class="absolute top-0 left-0 right-0 flex items-center justify-between px-5 shrink-0 z-20"
          style={{
            height: 'var(--bezel-top)',
            background: `linear-gradient(
              180deg,
              hsl(200 8% 38%) 0%,
              hsl(200 8% 32%) 15%,
              hsl(200 8% 26%) 50%,
              hsl(200 8% 22%) 85%,
              hsl(200 8% 18%) 100%
            )`,
            'border-bottom': '1px solid hsl(145 50% 35% / 0.3)',
            'box-shadow': `
              inset 0 2px 3px rgba(255, 255, 255, 0.12),
              inset 0 -2px 4px rgba(0, 0, 0, 0.3),
              0 4px 12px rgba(0, 0, 0, 0.5)
            `,
          }}
        >
          {/* Top left decorations */}
          <div class="flex items-center gap-4">
            <Screw />
            <VentSlots />
            <LedIndicator />
          </div>

          {/* Center brand plate */}
          <div
            class="px-5 py-1.5"
            style={{
              background: `linear-gradient(
                180deg,
                hsl(200 8% 28%) 0%,
                hsl(200 8% 22%) 50%,
                hsl(200 8% 18%) 100%
              )`,
              'border-radius': '3px',
              'box-shadow': `
                inset 1px 1px 2px rgba(0, 0, 0, 0.4),
                inset -1px -1px 1px rgba(255, 255, 255, 0.06),
                0 1px 0 rgba(255, 255, 255, 0.1)
              `,
            }}
          >
            <span
              class="text-[10px] font-bold tracking-[0.25em] uppercase"
              style={{
                color: 'hsl(145 70% 55%)',
                'text-shadow': '0 0 10px hsl(145 70% 50% / 0.5)',
              }}
            >
              Macro • Keyboard Trainer
            </span>
          </div>

          {/* Top right decorations */}
          <div class="flex items-center gap-4">
            <LedIndicator />
            <VentSlots />
            <Screw />
          </div>
        </div>

        {/* Left bezel - metallic */}
        <div
          class="absolute left-0 z-20"
          style={{
            top: 'var(--bezel-top)',
            bottom: 'var(--bezel-bottom)',
            width: 'var(--bezel-side)',
            background: `linear-gradient(
              90deg,
              hsl(200 8% 34%) 0%,
              hsl(200 8% 28%) 30%,
              hsl(200 8% 22%) 70%,
              hsl(200 8% 18%) 100%
            )`,
            'border-right': '1px solid hsl(145 50% 35% / 0.2)',
            'box-shadow': `
              inset 2px 0 3px rgba(255, 255, 255, 0.1),
              inset -2px 0 4px rgba(0, 0, 0, 0.3)
            `,
          }}
        />

        {/* Right bezel - metallic */}
        <div
          class="absolute right-0 z-20"
          style={{
            top: 'var(--bezel-top)',
            bottom: 'var(--bezel-bottom)',
            width: 'var(--bezel-side)',
            background: `linear-gradient(
              270deg,
              hsl(200 8% 34%) 0%,
              hsl(200 8% 28%) 30%,
              hsl(200 8% 22%) 70%,
              hsl(200 8% 18%) 100%
            )`,
            'border-left': '1px solid hsl(145 50% 35% / 0.2)',
            'box-shadow': `
              inset -2px 0 3px rgba(255, 255, 255, 0.1),
              inset 2px 0 4px rgba(0, 0, 0, 0.3)
            `,
          }}
        />

        {/* Bottom bezel with features and keyboard shortcuts - metallic */}
        <div
          class="absolute bottom-0 left-0 right-0 flex flex-col z-20"
          style={{
            height: 'var(--bezel-bottom)',
            background: `linear-gradient(
              0deg,
              hsl(200 8% 38%) 0%,
              hsl(200 8% 32%) 15%,
              hsl(200 8% 26%) 50%,
              hsl(200 8% 22%) 85%,
              hsl(200 8% 18%) 100%
            )`,
            'border-top': '1px solid hsl(145 50% 35% / 0.3)',
            'box-shadow': `
              inset 0 2px 4px rgba(0, 0, 0, 0.3),
              inset 0 -2px 3px rgba(255, 255, 255, 0.1),
              0 -4px 12px rgba(0, 0, 0, 0.5)
            `,
          }}
        >
          {/* Main row: Features (left) | Dismiss (center) | Shortcuts (right) */}
          <div class="flex items-center justify-between px-4 py-2.5 flex-1">
            {/* Left side: Feature tutorial buttons */}
            <div class="flex items-center gap-1">
              <Screw class="mr-2" />
              <For each={featureTutorials}>
                {(feature) => (
                  <FeatureBadge
                    keyLabel={feature.key}
                    description={feature.label}
                    onClick={() => setActiveTutorial(feature.key)}
                  />
                )}
              </For>
            </div>

            {/* Right side: Keyboard shortcuts */}
            <div class="flex items-center gap-3">
              <KeyBadge keyLabel="J" description="Down" keyCode="j" />
              <KeyBadge keyLabel="K" description="Up" keyCode="k" />
              
              {/* Divider */}
              <div
                class="w-px h-5"
                style={{
                  background: 'hsl(145 60% 40% / 0.4)',
                  'box-shadow': '0 0 6px hsl(145 60% 50% / 0.3)',
                }}
              />
              
              <KeyBadge keyLabel="P" description="Preview" keyCode="p" />
              <KeyBadge keyLabel="↵" description="Open" keyCode="enter" />
              <Screw class="ml-2" />
            </div>
          </div>

          {/* Bottom row with dismiss button */}
          <div class="flex items-center justify-center px-6 pb-2.5">
            <div class="flex items-center gap-3 absolute left-4">
              <Screw />
              <VentSlots />
            </div>
            <DismissButton onClick={hideBezel} />
            <div class="flex items-center gap-3 absolute right-4">
              <VentSlots />
              <Screw />
            </div>
          </div>
        </div>

        {/* Screen area - the actual app content */}
        <div
          class="absolute overflow-hidden"
          style={{
            top: 'var(--bezel-top)',
            left: 'var(--bezel-side)',
            right: 'var(--bezel-side)',
            bottom: 'var(--bezel-bottom)',
            'box-shadow': `
              inset 4px 4px 8px rgba(0, 0, 0, 0.5),
              inset -2px -2px 6px rgba(0, 0, 0, 0.3)
            `,
          }}
        >
          {/* Inner glow effect */}
          <div
            class="absolute inset-0 pointer-events-none z-10"
            style={{
              'box-shadow': `
                inset 0 0 40px hsl(145 60% 50% / 0.04),
                inset 0 0 2px hsl(145 60% 40% / 0.15)
              `,
            }}
          />
          {/* App content container - this div constrains the app */}
          <div class="relative w-full h-full">{props.children}</div>
        </div>
      </div>
    </Show>
  );
};


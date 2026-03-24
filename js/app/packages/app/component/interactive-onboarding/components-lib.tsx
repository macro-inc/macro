import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { Hotkey } from '@core/component/Hotkey';

const DISPLAY_TO_EVENT_KEY: Record<string, string> = {
  '↓': 'arrowdown',
  '↑': 'arrowup',
  '←': 'arrowleft',
  '→': 'arrowright',
  esc: 'escape',
  enter: 'enter',
  cmd: 'meta',
  '⌘': 'meta',
};

function displayToEventKey(display: string): string {
  const lower = display.toLowerCase();
  return DISPLAY_TO_EVENT_KEY[lower] ?? lower;
}

interface HotkeyCalloutProps {
  keys: string[];
  label: string;
  size?: 'lg' | 'sm';
  separator?: string;
  /** When true, all keys stay permanently highlighted. */
  completed?: boolean;
}

export function HotkeyCallout(props: HotkeyCalloutProps) {
  const isLarge = () => (props.size ?? 'lg') === 'lg';
  const [activeKeys, setActiveKeys] = createSignal<Set<string>>(new Set());
  // Keys that have been pressed at least once (for progressive chord feedback)
  const [everPressed, setEverPressed] = createSignal<Set<string>>(new Set());
  // Whether the full chord was completed (all keys held simultaneously)
  const [chordDone, setChordDone] = createSignal(false);

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (chordDone() || props.completed) return;
      const pressed = e.key.toLowerCase();
      const match = props.keys.find((k) => displayToEventKey(k) === pressed);
      if (match) {
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.add(match);
          // Check if all keys in the chord are now active
          if (next.size === props.keys.length) {
            setChordDone(true);
          }
          return next;
        });
        setEverPressed((prev) => {
          const next = new Set(prev);
          next.add(match);
          return next;
        });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (chordDone() || props.completed) return;
      const released = e.key.toLowerCase();
      const isModifier = released === 'meta' || released === 'control';
      if (isModifier) {
        setActiveKeys(new Set<string>());
      } else {
        setActiveKeys((prev) => {
          const matched = props.keys.find(
            (k) => displayToEventKey(k) === released
          );
          if (!matched) return prev;
          const next = new Set(prev);
          next.delete(matched);
          return next;
        });
      }
    };
    const onBlur = () => {
      if (!chordDone() && !props.completed) {
        setActiveKeys(new Set<string>());
      }
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onBlur);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      document.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
    });
  });

  const isLocked = () => props.completed || chordDone();

  /** Per-key highlight state: 'full' | 'partial' | 'none' */
  const keyState = (key: string): 'full' | 'partial' | 'none' => {
    if (isLocked()) return 'full';
    if (activeKeys().has(key)) return 'full';
    if (everPressed().has(key)) return 'partial';
    return 'none';
  };

  return (
    <div
      class={cn(
        isLarge()
          ? 'flex items-center gap-3 rounded-xs bg-hover/50 px-4 py-3 border border-edge-muted'
          : 'inline-flex items-center gap-1.5'
      )}
    >
      <div class="flex items-center gap-1.5">
        <For each={props.keys}>
          {(key, i) => (
            <>
              {i() > 0 && props.separator && (
                <span
                  class={cn('text-ink/40', isLarge() ? 'text-sm' : 'text-xs')}
                >
                  {props.separator}
                </span>
              )}
              <span
                class={cn(
                  'rounded-sm border',
                  isLarge() ? 'px-2.5 py-1 text-base' : 'px-1.5 py-0.5 text-xs',
                  keyState(key) === 'full'
                    ? 'bg-ink border-ink text-panel'
                    : keyState(key) === 'partial'
                      ? 'bg-ink/15 border-edge-muted text-ink'
                      : 'bg-hover/50 border-edge-muted text-ink'
                )}
              >
                {key}
              </span>
            </>
          )}
        </For>
      </div>
      <span
        class={cn(isLarge() ? 'text-sm text-ink/70' : 'text-sm text-ink/70')}
      >
        {props.label}
      </span>
    </div>
  );
}

interface ContinueButtonProps {
  onClick: () => void;
  label?: string;
  ghost?: boolean;
  ref?: (el: HTMLButtonElement) => void;
}

export function ContinueButton(props: ContinueButtonProps) {
  return (
    <button
      ref={props.ref}
      type="button"
      class={cn(
        'w-full px-4 py-2.5 text-lg font-bold rounded-xs flex items-center justify-between gap-2 bracket-never',
        props.ghost
          ? 'bg-transparent text-ink/40 font-normal'
          : 'bg-accent text-panel hover:bg-accent hover:ring-2 ring-accent ring-offset-1 focus:ring-2'
      )}
      onClick={props.onClick}
    >
      {props.label ?? 'Continue'}
      <span
        class={cn(
          'text-sm px-3 py-1 border rounded-sm',
          props.ghost
            ? 'border-edge-muted text-ink/30'
            : 'border-panel/50 text-panel'
        )}
      >
        <Hotkey shortcut="cmd+enter" />
      </span>
    </button>
  );
}

interface SkipButtonProps {
  onClick: () => void;
}

export function SkipButton(props: SkipButtonProps) {
  return (
    <button
      type="button"
      class="w-full px-4 py-2.5 text-lg rounded-xs flex items-center justify-between gap-2 bg-transparent text-ink/40 hover:bg-hover/60"
      onClick={props.onClick}
    >
      Skip
      <span class="text-sm px-3 py-1 border rounded-sm border-edge-muted text-ink/30">
        esc
      </span>
    </button>
  );
}

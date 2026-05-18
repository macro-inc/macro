import CheckIcon from '@icon/check.svg';
import { cn } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

interface CalloutShellProps {
  leader: string;
  label: string;
  completed?: boolean;
  children: JSX.Element;
}

function CalloutShell(props: CalloutShellProps) {
  return (
    <div class="flex items-center gap-3 rounded-xs bg-hover/50 px-4 py-3 border border-edge-muted">
      <span class="text-sm text-muted">{props.leader}</span>
      <div class="flex items-center gap-2.5">{props.children}</div>
      <span class="text-sm text-muted">{props.label}</span>
      <Show when={props.completed}>
        <div class="bg-accent text-surface size-5 rounded xs flex items-center justify-center ml-auto">
          <CheckIcon class="size-4" />
        </div>
      </Show>
    </div>
  );
}

const DISPLAY_TO_EVENT_KEY: Record<string, string> = {
  '↓': 'arrowdown',
  '↑': 'arrowup',
  '←': 'arrowleft',
  '→': 'arrowright',
  esc: 'escape',
  enter: 'enter',
  cmd: 'meta',
  '⌘': 'meta',
  ctrl: 'control',
};

function displayToEventKey(display: string): string {
  const lower = display.toLowerCase();
  return DISPLAY_TO_EVENT_KEY[lower] ?? lower;
}

interface HotkeyCalloutProps {
  keys: string[];
  label: string;
  separator?: string;
  completed?: boolean;
}

export function HotkeyCallout(props: HotkeyCalloutProps) {
  const [pressedKeys, setPressedKeys] = createSignal<Set<string>>(new Set());

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const pressed = e.key.toLowerCase();
      const match = props.keys.find((k) => displayToEventKey(k) === pressed);
      if (match) {
        setPressedKeys((prev) => new Set(prev).add(match));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (props.completed) return;
      const released = e.key.toLowerCase();
      // When a modifier is released the OS swallows subsequent keyup events,
      // so clear everything to prevent keys getting stuck.
      if (released === 'meta' || released === 'control' || released === 'alt') {
        setPressedKeys(new Set([]));
        return;
      }
      setPressedKeys((prev) => {
        const matched = props.keys.find(
          (k) => displayToEventKey(k) === released
        );
        if (!matched) return prev;
        const next = new Set(prev);
        next.delete(matched);
        return next;
      });
    };
    const clearAll = () => {
      if (!props.completed) setPressedKeys(new Set([]));
    };
    const onVisibilityChange = () => {
      if (document.hidden) clearAll();
    };
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('keyup', onKeyUp, { capture: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('blur', clearAll);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      document.removeEventListener('keyup', onKeyUp, { capture: true });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', clearAll);
    });
  });

  return (
    <CalloutShell leader="Type" label={props.label} completed={props.completed}>
      <style>{`
        @keyframes hotkey-pulse {
          0%   { outline: 2px solid rgb(from var(--color-edge) r g b / 0.3); outline-offset: 0px; }
          100%   { outline: 2px solid rgb(from var(--color-edge) r g b / 0); outline-offset: 10px; }
        }
        .hotkey-pulsing {
          animation: hotkey-pulse 1.4s cubic-bezier(0.2, 0.8, 0.4, 1);
        }
      `}</style>
      <For each={props.keys}>
        {(key, i) => {
          let keyRef: HTMLSpanElement | undefined;

          const isPressed = () => pressedKeys().has(key);

          onMount(() => {
            const onKeyDown = (e: KeyboardEvent) => {
              const pressed = e.key.toLowerCase();
              if (displayToEventKey(key) !== pressed) return;
              if (!keyRef) return;
              keyRef.classList.remove('hotkey-pulsing');
              void keyRef.offsetWidth; // reflow to restart animation
              keyRef.classList.add('hotkey-pulsing');
            };
            const onAnimationEnd = () => {
              keyRef?.classList.remove('hotkey-pulsing');
            };
            document.addEventListener('keydown', onKeyDown, {
              capture: true,
            });
            keyRef?.addEventListener('animationend', onAnimationEnd);
            onCleanup(() => {
              document.removeEventListener('keydown', onKeyDown, {
                capture: true,
              });
              keyRef?.removeEventListener('animationend', onAnimationEnd);
            });
          });

          return (
            <>
              {i() > 0 && props.separator && (
                <span class="text-sm text-muted">{props.separator}</span>
              )}
              <span
                ref={keyRef}
                class={cn(
                  'inline-grid place-items-center rounded-sm border px-2.5 py-1 text-base',
                  isPressed() || props.completed
                    ? 'bg-ink/20 border-edge text-ink'
                    : 'bg-ink/10 border-edge text-ink'
                )}
              >
                {key}
              </span>
            </>
          );
        }}
      </For>
    </CalloutShell>
  );
}

interface ClickCalloutProps {
  icon: Component<Record<string, unknown>>;
  label: string;
  completed?: boolean;
}

export function ClickCallout(props: ClickCalloutProps) {
  return (
    <CalloutShell
      leader="Click"
      label={props.label}
      completed={props.completed}
    >
      <span
        class={cn(
          'inline-grid place-items-center rounded-sm border aspect-square h-8.5',
          props.completed
            ? 'bg-ink/20 border-edge text-ink'
            : 'bg-ink/10 border-edge text-ink'
        )}
      >
        <span class="size-3.5 inline-grid place-items-center">
          <Dynamic component={props.icon} />
        </span>
      </span>
    </CalloutShell>
  );
}

interface ContinueButtonProps {
  onClick: () => void;
  label?: string;
  disabled?: boolean;
  ref?: (el: HTMLButtonElement) => void;
  centered?: boolean;
}

export function ContinueButton(props: ContinueButtonProps) {
  return (
    <button
      ref={props.ref}
      type="button"
      class={cn(
        'w-full px-3 py-2.5 text-lg font-bold rounded-xs flex items-center gap-2 border-none',
        props.centered ? 'justify-center' : 'justify-between',
        {
          'bg-transparent text-ink/40 font-normal ring-1 ring-edge-muted':
            props.disabled,
          'bg-accent text-surface hover:bg-accent hover:ring-2 ring-accent ring-offset-1 ring-offset-surface focus:ring-2':
            !props.disabled,
        }
      )}
      onClick={props.onClick}
    >
      {props.label ?? 'Continue'}
      {/*<span
        class={cn(
          'text-sm px-3 py-1 border rounded-sm flex items-center gap-1 border-surface/50 text-surface',
          { 'opacity-0': props.disabled }
        )}
      >
        <Hotkey shortcut="cmd" />
        <span>+</span>
        <span>Enter</span>
      </span>*/}
    </button>
  );
}

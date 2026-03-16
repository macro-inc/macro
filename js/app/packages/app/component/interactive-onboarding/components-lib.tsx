import { For } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { Hotkey } from '@core/component/Hotkey';

interface HotkeyCalloutProps {
  keys: string[];
  label: string;
  size?: 'lg' | 'sm';
  separator?: string;
}

export function HotkeyCallout(props: HotkeyCalloutProps) {
  const isLarge = () => (props.size ?? 'lg') === 'lg';

  return (
    <div
      class={cn(
        isLarge()
          ? 'flex items-center gap-3 rounded-sm bg-hover/50 px-4 py-3'
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
                  'rounded-sm border border-edge-muted',
                  isLarge()
                    ? 'px-2.5 py-1 text-base text-ink'
                    : 'px-1.5 py-0.5 text-xs text-ink/80'
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
}

export function ContinueButton(props: ContinueButtonProps) {
  return (
    <button
      type="button"
      class={cn(
        'w-full px-4 py-2.5 text-lg font-bold rounded-xs flex items-center justify-between gap-2',
        props.ghost
          ? 'bg-transparent text-ink/40 font-normal'
          : 'bg-accent text-panel hover:bg-accent hover:ring-2 ring-accent ring-offset-1'
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

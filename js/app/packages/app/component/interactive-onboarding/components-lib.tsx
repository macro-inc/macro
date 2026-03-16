import { cn } from '@ui/utils/classname';

interface HotkeyCalloutProps {
  keys: string[];
  label: string;
  size?: 'lg' | 'sm';
}

export function HotkeyCallout(props: HotkeyCalloutProps) {
  const isLarge = () => (props.size ?? 'lg') === 'lg';

  return (
    <div
      class={cn(
        isLarge()
          ? 'flex items-center gap-3 rounded-lg border border-edge-muted px-4 py-3'
          : 'inline-flex items-center gap-1.5'
      )}
    >
      <div class="flex items-center gap-1.5">
        {props.keys.map((key) => (
          <kbd
            class={cn(
              'rounded bg-hover/50 font-mono',
              isLarge()
                ? 'px-2.5 py-1 text-base text-ink'
                : 'px-1.5 py-0.5 text-xs text-ink/80'
            )}
          >
            {key}
          </kbd>
        ))}
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
}

export function ContinueButton(props: ContinueButtonProps) {
  return (
    <button
      type="button"
      class="w-full px-4 py-2.5 text-sm font-medium bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
      onClick={props.onClick}
    >
      Continue
      <kbd class="text-xs opacity-70 font-mono">&#8984;&#9166;</kbd>
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
      class="w-full px-4 py-2.5 text-sm text-ink/60 hover:text-ink/90 hover:bg-hover/30 rounded-lg transition-colors"
      onClick={props.onClick}
    >
      Skip
    </button>
  );
}

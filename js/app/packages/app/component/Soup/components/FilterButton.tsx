import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';

/**
 * Renders a label with the shortcut character underlined.
 * E.g., "Inbox" with shortcut "i" renders "Inbox" with "I" underlined.
 */
export const renderShortcutUnderlinedInLabel = (
  label: string,
  shortcut: string
): JSX.Element => {
  const s = shortcut.trim();
  if (!s) return <>{label}</>;

  // Special case for space shortcut
  if (s.toLowerCase() === 'space') {
    return (
      <>
        {label}
        <span class="ml-1 font-mono opacity-70">␣</span>
      </>
    );
  }

  // Special case for slash shortcut
  if (s === '/') {
    return (
      <>
        {label}
        <span class="ml-1 font-mono opacity-70">/</span>
      </>
    );
  }

  // Find and underline the shortcut character in the label
  const idx = label.toLowerCase().indexOf(s.toLowerCase());
  if (idx === -1) return <>{label}</>;

  const before = label.slice(0, idx);
  const match = label.slice(idx, idx + s.length);
  const after = label.slice(idx + s.length);

  return (
    <>
      {before}
      <span class="underline underline-offset-2 decoration-current/60">
        {match}
      </span>
      {after}
    </>
  );
};

export interface FilterButtonProps {
  /** Icon component to render */
  icon: Component<{ class?: string }>;
  /** Button label text */
  label: string;
  /** Keyboard shortcut for tooltip */
  shortcut: string;
  /** Whether the filter is currently active */
  isActive: () => boolean;
  /** Click handler */
  onClick: () => void;
  /** Optional custom padding (default: pl-2 pr-2.5) */
  paddingClass?: string;
}

/**
 * Reusable filter button component for the Soup topbar.
 * Renders a pill-shaped button with icon, label, and tooltip showing the shortcut.
 */
export const FilterButton: Component<FilterButtonProps> = (props) => {
  const paddingClass = () => props.paddingClass ?? 'pl-2 pr-2.5';

  return (
    <div class="flex items-center mr-0.5 shrink-0">
      <Tooltip
        tooltip={
          <LabelAndHotKey label={props.label} shortcut={props.shortcut} />
        }
      >
        <button
          type="button"
          class={`flex items-center gap-1 h-[22px] ${paddingClass()} active:bg-accent active:text-panel rounded-full`}
          classList={{
            'bg-accent text-panel': props.isActive(),
            'text-ink-muted hover:text-accent hover:bg-accent/20':
              !props.isActive(),
          }}
          onClick={props.onClick}
        >
          <Dynamic component={props.icon} class="size-4.5" />
          <span class="text-xs leading-none">
            {renderShortcutUnderlinedInLabel(props.label, props.shortcut)}
          </span>
        </button>
      </Tooltip>
    </div>
  );
};

/**
 * Divider component for separating filter button groups.
 */
export const FilterDivider: Component = () => (
  <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
);

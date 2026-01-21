import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { LabelAndHotKey, Tooltip } from '@core/component/Tooltip';

const SHORTCUT_SUFFIXES: Record<string, string> = { space: '␣', '/': '/' };

export const ShortcutLabel: Component<{ label: string; shortcut: string }> = (
  props
) => {
  const s = props.shortcut.trim();
  if (!s) return <>{props.label}</>;

  const suffix = SHORTCUT_SUFFIXES[s.toLowerCase()] ?? SHORTCUT_SUFFIXES[s];
  if (suffix) {
    return (
      <>
        {props.label}
        <span class="ml-1 font-mono opacity-70">{suffix}</span>
      </>
    );
  }

  const idx = props.label.toLowerCase().indexOf(s.toLowerCase());
  if (idx === -1) return <>{props.label}</>;

  return (
    <>
      {props.label.slice(0, idx)}
      <span class="underline underline-offset-2 decoration-current/60">
        {props.label.slice(idx, idx + s.length)}
      </span>
      {props.label.slice(idx + s.length)}
    </>
  );
};

export interface FilterButtonProps {
  icon: Component<{ class?: string }>;
  label: string;
  shortcut: string;
  isActive: () => boolean;
  onClick: () => void;
  paddingClass?: string;
}

export const FilterButton: Component<FilterButtonProps> = (props) => (
  <div class="flex items-center mr-0.5 shrink-0">
    <Tooltip
      tooltip={<LabelAndHotKey label={props.label} shortcut={props.shortcut} />}
    >
      <button
        type="button"
        class={`flex items-center gap-1 h-[22px] touch:mobile-width:h-9 ${props.paddingClass ?? 'pl-2 pr-2.5'} active:bg-accent active:text-panel rounded-full`}
        classList={{
          'bg-accent text-panel': props.isActive(),
          'text-ink-muted hover:text-accent hover:bg-accent/20':
            !props.isActive(),
        }}
        onClick={props.onClick}
      >
        <Dynamic component={props.icon} class="size-3.5" />
        <span class="leading-none">
          <ShortcutLabel label={props.label} shortcut={props.shortcut} />
        </span>
      </button>
    </Tooltip>
  </div>
);

export const FilterDivider: Component = () => (
  <div class="mx-0.5 w-px h-5 bg-edge-muted/50 shrink-0" />
);

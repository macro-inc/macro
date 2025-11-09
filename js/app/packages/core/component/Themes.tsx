export type Theme =
  | 'base'
  | 'accent'
  | 'accentOpaque'
  | 'contrast'
  | 'clear'
  | 'selected'
  | 'green'
  | 'disabled'
  | 'red'
  | 'muted'
  | 'extraMuted'
  | 'accentFill'
  | 'current'
  | 'reverse';

// SCUFFED THEMING: accent theme would work significantly better if we had multiple accent lightness values, instead of relying on calculations
// e.g. this would fail if accent color was too light
// it would be better if we also defined --accent-l-surface, --accent-l-contrast
export const themeColors: Record<Theme, string> = {
  base: 'text-ink border-edge!',
  accent: 'text-accent-ink border-accent/30',
  accentFill: 'text-dialog border-accent/30',
  accentOpaque:
    'text-accent-ink border-[oklch(from_var(--color-accent)_calc(l*0.9)_calc(c*0.8)_h)]',
  contrast: 'text-menu border-ink-extra-muted',
  clear: 'text-ink border-transparent',
  selected: 'text-ink border-edge',
  disabled: 'text-ink-disabled/50 border-edge/30',
  green: 'text-success-ink border-success/50',
  red: 'text-failure-ink border-failure/50',
  muted: 'text-ink-muted border-transparent',
  extraMuted: 'text-ink-extra-muted border-transparent',
  current: 'text-current border-transparent',
  reverse: 'bg-current border-transparent',
};

export const themeStyles: Record<Theme, string> = {
  base: 'bg-menu hover:bg-hover hover-transition-bg border border-inherit',
  accent:
    'bg-accent/10 hover:bg-accent/20 hover-transition-bg border border-inherit',
  accentFill: 'bg-accent hover-transition-bg border border-inherit',
  accentOpaque:
    'bg-[oklch(from_var(--color-accent)_calc(l*1.5)_calc(c*0.09)_h)] hover:bg-[oklch(from_var(--color-accent)_calc(l*1.4)_calc(c*0.15)_h)] border border-inherit hover-transition-bg',
  contrast:
    'bg-ink-muted hover:bg-ink hover-transition-bg border border-inherit',
  clear:
    'bg-transparent hover:bg-hover hover-transition-bg border border-transparent',
  selected: 'bg-hover hover:bg-hover hover-transition-bg border border-inherit',
  disabled: 'bg-menu/20 border border-inherit',
  green: 'bg-success-bg hover:bg-success border border-inherit',
  red: 'bg-failure-bg hover:bg-failure border border-inherit',
  muted:
    'bg-transparent hover:bg-hover hover-transition-bg border border-transparent',
  extraMuted:
    'bg-transparent hover:bg-hover hover-transition-bg border border-transparent',
  current: 'bg-transparent hover:bg-current/20',
  reverse: 'bg-current hover:bg-current/90',
};

export const themeSelectedColors: Record<Theme, string> = {
  base: 'bg-hover!',
  accent: 'bg-accent/20!',
  accentFill: 'bg-acent/80',
  accentOpaque:
    'bg-[oklch(from_var(--color-accent)_calc(l*1.4)_calc(c*0.15)_h)]!',
  contrast: 'bg-ink/20!',
  clear: 'bg-hover!',
  selected: 'bg-hover/30!',
  disabled: 'bg-hover/40!',
  green: 'bg-success-bg!',
  red: 'bg-failure-bg!',
  muted: 'bg-hover!',
  extraMuted: 'bg-hover!',
  current: 'bg-current/20',
  reverse: 'bg-current',
};

export const shortcutBadgeStyles: Record<Theme, string> = {
  base: 'bg-dialog border border-ink',
  accent: 'bg-accent/10',
  accentFill: 'bg-accent/90',
  accentOpaque:
    'bg-[oklch(from_var(--color-accent)_calc(l*1.5)_calc(c*0.09)_h)]',
  contrast: 'bg-ink/30',
  clear: 'bg-hover/10',
  selected: 'bg-hover/10',
  green: 'bg-success-bg/30',
  disabled: 'bg-hover/20',
  red: 'bg-failure-bg/30',
  muted: 'bg-hover',
  extraMuted: 'bg-hover',
  current: 'bg-current/20',
  reverse: 'bg-current',
};

/**
 * Centralized style constants for Properties components
 * Only includes actively used styles
 */

export const PROPERTY_STYLES = {
  input: {
    search:
      'w-full pl-10 pr-3 py-1 border border-edge text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent bg-input text-ink placeholder-ink-muted',
  },

  button: {
    base: 'px-3 py-1.5 text-sm border',
    secondary: 'text-ink-muted hover:text-ink border-edge hover:bg-hover',
    accent: 'text-accent hover:text-accent/80 border-accent hover:bg-accent/10',
  },

  value: {
    multiButton:
      'text-right text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0 max-w-[140px] break-words',
  },

  checkbox: {
    base: 'w-4 h-4 border flex items-center justify-center',
  },
} as const;

/**
 * Utility to combine class names, filtering out falsy values
 */
export function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

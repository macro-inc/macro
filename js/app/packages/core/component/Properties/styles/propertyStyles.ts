/**
 * Centralized style constants for Properties components
 */

export const PROPERTY_STYLES = {
  modal: {
    base: 'absolute bg-dialog border-3 border-edge shadow-xl z-modal max-h-96 overflow-hidden flex flex-col w-full max-w-md',
    overlay: 'fixed inset-0 bg-overlay z-modal-overlay',
    header: 'flex items-center justify-between p-4',
    content: 'flex-1 overflow-y-auto max-h-64 px-4 pb-2',
    closeButton:
      'text-ink-muted hover:text-ink text-xl w-5 h-5 flex items-center justify-center',
  },

  input: {
    base: 'w-full px-3 py-1.5 border border-edge text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
    inline:
      'text-right text-ink text-xs px-2 py-1 border border-edge bg-transparent focus:outline-none focus:border-accent',
    search:
      'w-full pl-10 pr-3 py-1 border border-edge text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent bg-input text-ink placeholder-ink-muted',
  },

  select: {
    base: 'w-full px-3 py-1.5 border border-edge bg-menu text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent text-ink',
  },

  button: {
    base: 'px-3 py-1.5 text-sm border',
    primary: 'bg-accent/90 hover:bg-accent/80 text-ink',
    secondary: 'text-ink-muted hover:text-ink border-edge hover:bg-hover',
    accent: 'text-accent hover:text-accent/80 border-accent hover:bg-accent/10',
    danger: 'bg-failure hover:bg-failure/90 text-failure-ink',
  },

  value: {
    display:
      'text-right text-xs px-2 py-1 border border-edge bg-transparent inline-block max-w-full',
    button:
      'text-right text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block max-w-full',
    multi:
      'text-right text-xs px-2 py-1 border border-edge bg-transparent inline-block shrink-0 max-w-[150px] break-words',
    multiButton:
      'text-right text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0 max-w-[150px] break-words',
  },

  checkbox: {
    base: 'w-4 h-4 border flex items-center justify-center',
    checked: 'bg-accent border-accent',
    unchecked: 'border-edge bg-transparent',
  },

  common: {
    spinner: 'w-5 h-5 animate-spin',
    loadingContainer: 'flex items-center justify-center py-8',
    errorText: 'text-failure-ink text-sm text-center',
    mutedText: 'text-ink-muted',
    truncate: 'truncate',
  },

  row: {
    base: 'flex gap-4 w-full group',
    label: 'flex-shrink-0 min-w-[100px] max-w-[45%]',
    value: 'flex-1 flex justify-end',
  },
} as const;

/**
 * Utility to combine class names, filtering out falsy values
 */
export function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

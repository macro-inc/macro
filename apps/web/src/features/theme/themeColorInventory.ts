import { inputColorTokens, semanticTokens } from './types/themeTypes';

/**
 * Every `--color-*` token defined in the `@theme` block of `index.css`,
 * grouped by how it is authored. The test next to this file fails if CSS
 * grows or drops a name that is not listed here.
 *
 * V3 themes only persist the input + semantic registries. Everything else
 * is CSS-owned: generated variants, entity aliases, or utilities.
 */

/** Raw colors a V3 theme must store. Tailwind has no `text-content-*`. */
export const inventoryInputTokens = inputColorTokens;

/** Component-facing semantics the theme editor can override. */
export const inventorySemanticTokens = semanticTokens;

/**
 * Extra `--color-*` assignments that live only in CSS. Themes can still
 * reference them (`var(--color-control)`) but they are not in the V3
 * registry and do not appear in the token editor.
 */
export const inventoryCssOnlyTokens = [
  'accent-contrast',
  'accent-contrast-muted',
  'control',
  'edge-frame',
  'edge-button',
  'edge-divider',
  'edge-focus',
  'menu-glass',
  'composer',
  'composer-ink',
  'composer-placeholder',
  'composer-action',
  'composer-action-ink',
  'code-buffer',
  'thread-rail',
  'modal-overlay',
  'drop-shadow',
  'avatar-edge',
  'skeleton',
  'list-hover',
  'list-highlighted',
  'list-selected',
  'list-selected-highlighted',
  'ink-extra-muted',
  'button',
  'overlay',
] as const;

/** `{hue}-bg` / `{hue}-ink` / `{hue}-hover` plus status and alert copies. */
export const inventoryGeneratedVariantTokens = [
  'accent-bg',
  'accent-ink',
  'accent-hover',
  'red-bg',
  'red-ink',
  'red-hover',
  'orange-bg',
  'orange-ink',
  'orange-hover',
  'amber-bg',
  'amber-ink',
  'amber-hover',
  'yellow-bg',
  'yellow-ink',
  'yellow-hover',
  'lime-bg',
  'lime-ink',
  'lime-hover',
  'green-bg',
  'green-ink',
  'green-hover',
  'teal-bg',
  'teal-ink',
  'teal-hover',
  'cyan-bg',
  'cyan-ink',
  'cyan-hover',
  'blue-bg',
  'blue-ink',
  'blue-hover',
  'violet-bg',
  'violet-ink',
  'violet-hover',
  'purple-bg',
  'purple-ink',
  'purple-hover',
  'pink-bg',
  'pink-ink',
  'pink-hover',
  'success-bg',
  'success-ink',
  'success-hover',
  'warning-bg',
  'warning-ink',
  'warning-hover',
  'failure-bg',
  'failure-ink',
  'failure-hover',
  'alert',
  'alert-bg',
  'alert-ink',
] as const;

/** Entity / icon hues. Aliases of the authored palette, not independently themed. */
export const inventoryEntityTokens = [
  'comment',
  'comment-bg',
  'comment-ink',
  'calendar',
  'contact',
  'canvas',
  'folder',
  'image',
  'video',
  'write',
  'code',
  'chat',
  'html',
  'note',
  'task',
  'snippet',
  'pdf',
  'rss',
  'default',
  'email',
] as const;

export const inventoryAllThemeColorTokens = [
  ...inventoryInputTokens,
  ...inventorySemanticTokens,
  ...inventoryCssOnlyTokens,
  ...inventoryGeneratedVariantTokens,
  ...inventoryEntityTokens,
] as const;

export type ThemeColorInventoryToken =
  (typeof inventoryAllThemeColorTokens)[number];

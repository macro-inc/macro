import type { BlockName } from '@core/block';

// Standard size options
export const FILE_LIST_SIZE = {
  xs: 'xs',
  sm: 'sm',
  md: 'md',
  lg: 'lg',
} as const;

export type FileListSize = keyof typeof FILE_LIST_SIZE;

export const FILE_LIST_ROW_HEIGHT = {
  [FILE_LIST_SIZE.xs]: 'h-[24px]',
  [FILE_LIST_SIZE.sm]: 'h-[37px]',
  [FILE_LIST_SIZE.md]: 'h-[54px]',
  [FILE_LIST_SIZE.lg]: 'h-[71px]',
} as const;

export const FILE_LIST_CARET_WIDTH = {
  [FILE_LIST_SIZE.xs]: 'min-w-[16px]',
  [FILE_LIST_SIZE.sm]: 'min-w-[16px]',
  [FILE_LIST_SIZE.md]: 'min-w-[20px]',
  [FILE_LIST_SIZE.lg]: 'min-w-[24px]',
} as const;

export const FILE_LIST_SPACER_WIDTH = {
  [FILE_LIST_SIZE.xs]: 'min-w-[8px]',
  [FILE_LIST_SIZE.sm]: 'min-w-[8px]',
  [FILE_LIST_SIZE.md]: 'min-w-[10px]',
  [FILE_LIST_SIZE.lg]: 'min-w-[12px]',
} as const;

export const FILE_LIST_TEXT_SIZE = {
  [FILE_LIST_SIZE.sm]: 'text-sm',
  [FILE_LIST_SIZE.md]: 'text-md',
  [FILE_LIST_SIZE.lg]: 'text-lg',
} as const;

export const TEXT_SIZE_CLASSES = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  fill: 'text-2xl',
} as const;

// These are deprecated, only in use until we migrate Item.tsx and ProjectItem.tsx to use the new ListViewRow system, with size.ts
export const SMALL_ITEM_HEIGHT = 'h-[37px] ';
export const LARGE_ITEM_HEIGHT = 'h-[54px] ';

export const SMALL_BLOCK_ICON = 'sm';
export const LARGE_BLOCK_ICON = 'md';

// Enumerate the background styles for selected-state items.
export const defaultFileColor = 'bg-hover/20 group/item';

export const fileTypeColors: Record<BlockName | 'default', string> = {
  write: 'bg-write/20 group/item',
  pdf: 'bg-pdf/20 group/item',
  md: 'bg-note/20 group/item',
  code: 'bg-code/20 group/item',
  image: 'bg-image/20 group/item',
  canvas: 'bg-canvas/20 group/item',
  video: 'bg-video/20 group/item',
  color: 'bg-color/20 group/item',
  contact: defaultFileColor,
  default: defaultFileColor,
  chat: defaultFileColor,
  html: defaultFileColor,
  channel: defaultFileColor,
  email: defaultFileColor,
  start: defaultFileColor,
  project: defaultFileColor,
  unknown: defaultFileColor,
};

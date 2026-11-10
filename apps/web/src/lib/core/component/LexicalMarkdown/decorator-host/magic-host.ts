import type { DecoratorSelectionHost } from './selection-host';

/** The Magic Chip's actual document, editability, and selection dependencies. */
export interface MagicChipHost extends DecoratorSelectionHost {
  isDocument(): boolean;
  isEditable(): boolean;
  selectNode(key: string): void;
}

export interface MagicChipHostProp {
  readonly host?: MagicChipHost;
}

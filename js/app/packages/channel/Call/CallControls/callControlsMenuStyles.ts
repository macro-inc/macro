import { MENU_ITEM_CLASS } from '@core/component/Menu';
import { cn } from '@ui/utils/classname';

export const menuItemClass = cn(
  MENU_ITEM_CLASS,
  'cursor-pointer hover:bg-hover hover-transition-bg'
);

export const menuGroupLabelClass = `${MENU_ITEM_CLASS} text-xs! text-ink-extra-muted`;

export const leaveItemClass = cn(
  MENU_ITEM_CLASS,
  'cursor-pointer text-failure hover:bg-failure/10 hover-transition-bg'
);

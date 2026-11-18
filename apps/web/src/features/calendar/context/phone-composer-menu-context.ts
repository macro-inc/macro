import { type Accessor, createContext, useContext } from 'solid-js';
import type { ComposerWhenModel } from '../primitives/create-composer-when';
import type {
  PhoneMenuId,
  PhoneMenuPattern,
} from '../primitives/phone-menu-pattern';

export interface PhoneComposerMenuContextValue {
  when: ComposerWhenModel;
  pattern: (menu: PhoneMenuId) => PhoneMenuPattern;
  page: Accessor<boolean>;
  mount: Accessor<HTMLElement | undefined>;
  open: (menu: PhoneMenuId, trigger: HTMLButtonElement) => void;
  close: () => void;
}
export const PhoneComposerMenuContext =
  createContext<PhoneComposerMenuContextValue>();
export function usePhoneComposerMenu() {
  const context = useContext(PhoneComposerMenuContext);
  if (!context)
    throw new Error('Phone composer menus require PhoneComposerMenuRoot');
  return context;
}

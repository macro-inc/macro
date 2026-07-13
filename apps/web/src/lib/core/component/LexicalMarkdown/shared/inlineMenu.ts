/**
 * @file Shared code for inline menus.
 */

import { type Accessor, createSignal, type Setter } from 'solid-js';

export type MenuOperations = {
  openMenu: () => void;
  closeMenu: () => void;
  searchTerm: Accessor<string>;
  setSearchTerm: (searchTerm: string) => void;
  isOpen: Accessor<boolean>;
  setIsOpen: Setter<boolean>;
};

export function createMenuOperations(
  onOpenCallback?: () => void,
  onCloseCallback?: () => void
): MenuOperations {
  const [isOpen, setIsOpen] = createSignal(false);
  const [searchTerm, setSearchTerm] = createSignal('');

  const menuOperations = {
    openMenu: () => {
      onOpenCallback?.();
      setIsOpen(true);
    },
    closeMenu: () => {
      onCloseCallback?.();
      setIsOpen(false);
    },
    searchTerm,
    setSearchTerm,
    isOpen,
    setIsOpen,
  };

  return menuOperations;
}

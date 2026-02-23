import { createSignal } from 'solid-js';
import { attributesToSelector } from './attributeToSelector';

/** actively open menus that may try to return focus */
const activeFocusOwners = new Set<string>();

/** the return-focus target of the first-opened menu */
let rootFocusElement: Element | null = null;

let ownerIdCounter = 0;
let pendingFocusReturn: (() => void) | null = null;

/** simple id generator */
function generateOwnerId(prefix?: string): string {
  return `${prefix ?? 'menu'}-${++ownerIdCounter}`;
}

/**
 * Focus and update lock metadata
 */
function acquireFocusLock(id: string): void {
  if (pendingFocusReturn) {
    pendingFocusReturn = null;
  }

  const wasEmpty = activeFocusOwners.size === 0;

  if (wasEmpty && rootFocusElement === null) {
    rootFocusElement = document.activeElement;
  }
  activeFocusOwners.add(id);
}

/**
 * Release focus and handle return to last state.
 * @param id
 */
function releaseFocusLock(id: string, shouldReturnFocus: boolean): void {
  activeFocusOwners.delete(id);

  if (activeFocusOwners.size === 0 && rootFocusElement) {
    if (shouldReturnFocus) {
      // Defer focus return to allow another menu to acquire first. Sometimes
      // next menu opens first, but sometime we close before next menu opens.
      const elementToFocus = rootFocusElement;

      pendingFocusReturn = () => {
        // Only return focus if no one else has acquired
        if (activeFocusOwners.size === 0) {
          focusLast(elementToFocus);
          rootFocusElement = null;
        }
        pendingFocusReturn = null;
      };

      // queueMicrotask so it runs after synchronous code but before next setTimeout
      queueMicrotask(() => {
        if (pendingFocusReturn) {
          pendingFocusReturn();
        }
      });
    } else {
      rootFocusElement = null;
    }
  }
}

function focusLast(element: Element) {
  // has to fire two tasks after to prevent Kobalte menus stealing focus and opening menu on up/down keypress
  // i guess not - until it does once again
  setTimeout(() => {
    // Don't steal focus if another menu has acquired in the meantime
    if (activeFocusOwners.size > 0) {
      return;
    }

    if (element instanceof HTMLElement) {
      if (element.isConnected) {
        element.focus();
      } else {
        // This only works for restoring previously focused entity in UnifiedList, this a workaround previous focused Entity nodes being removed from the dom and focusing to body
        // attributeToSelector still doesn't guarentee node is unique for all cases
        // new rendered node might have different arribute value
        const selector = attributesToSelector(element);
        const fallbackElement = document.querySelector(selector) as HTMLElement;

        if (fallbackElement instanceof HTMLElement) {
          fallbackElement.focus();
        }
      }
    }
  });
}

export const createControlledOpenSignal = (
  value?: boolean,
  options?: {
    id?: string;
  }
) => {
  const ownerId = generateOwnerId(options?.id);
  const [createMenuOpen, setCreateMenuOpen] = createSignal(value ?? false);

  const customSetter = (
    next: boolean | ((prev: boolean) => boolean),
    shouldReturnFocusToPreviousElement = true
  ) => {
    const prevOpen = createMenuOpen();
    const isOpenResult = setCreateMenuOpen(next);

    if (!prevOpen && isOpenResult) {
      acquireFocusLock(ownerId);
      return;
    }

    if (prevOpen && !isOpenResult) {
      releaseFocusLock(ownerId, shouldReturnFocusToPreviousElement);
    }
  };

  return [createMenuOpen, customSetter] as const;
};

import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { createSignal } from 'solid-js';
import { attributesToSelector } from './attributeToSelector';

let previouslyFocusedElement = document.activeElement;
export const createControlledOpenSignal = (value?: boolean) => {
  const [createMenuOpen, setCreateMenuOpen] = createSignal(value ?? false);

  const customSetter = (
    next: boolean | ((prev: boolean) => boolean),
    shouldReturnFocusToPreviousElement = true
  ) => {
    const activeElement = document.activeElement;
    const isOpenResult = setCreateMenuOpen(next);

    if (isOpenResult) {
      previouslyFocusedElement = activeElement;

      if (DEV_MODE_ENV)
        console.info('Borrowing focus from', previouslyFocusedElement);
      return;
    }

    if (!shouldReturnFocusToPreviousElement) return;

    // has to fire two tasks after to prevent Kobalte menus stealing focus and opening menu on up/down keypress
    // i guess not - until it does once again
    setTimeout(() => {
      if (previouslyFocusedElement instanceof HTMLElement) {
        if (previouslyFocusedElement.isConnected) {
          previouslyFocusedElement.focus();
        } else {
          // This only works for restoring previously focused entity in UnifiedList, this a workaround previous focused Entity nodes being removed from the dom and focusing to body

          // attributeToSelector still doesn't guarentee node is unique for all cases
          // new rendered node might have different arribute value
          previouslyFocusedElement = document.querySelector(
            attributesToSelector(previouslyFocusedElement)
          ) as HTMLElement;
          if (previouslyFocusedElement instanceof HTMLElement) {
            previouslyFocusedElement.focus();
            if (DEV_MODE_ENV)
              console.info('returning focus to', previouslyFocusedElement);
          }
        }
      }
    });
  };
  return [createMenuOpen, customSetter] as const;
};

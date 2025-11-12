import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { createSignal, type Setter } from 'solid-js';
import { attributesToSelector } from './attributeToSelector';

let previouslyFocusedElement = document.activeElement;
export const createControlledOpenSignal = (value?: boolean) => {
  const [createMenuOpen, setCreateMenuOpen] = createSignal(value ?? false);

  const customSetter: Setter<boolean> = (prev) => {
    const isOpenResult = setCreateMenuOpen(prev);

    if (isOpenResult) {
      previouslyFocusedElement = document.activeElement;

      if (DEV_MODE_ENV)
        console.info('Borrowing focus from', previouslyFocusedElement);
    } else {
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
    }
  };
  return [createMenuOpen, customSetter] as const;
};

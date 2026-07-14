import { type Accessor, createEffect, on, onCleanup } from 'solid-js';

export type ListNavActions = {
  next: VoidFunction;
  previous: VoidFunction;
  select: VoidFunction;
};

export function useListKeyBindings(elem: Accessor<HTMLElement | undefined>) {
  let actions: ListNavActions | undefined;
  let unbind: VoidFunction | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
      e.preventDefault();
      actions?.next();
    } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
      e.preventDefault();
      actions?.previous();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      actions?.select();
    }
  };

  createEffect(
    on(elem, (el) => {
      unbind?.();
      if (!el) return;
      el.addEventListener('keydown', onKeyDown);
      unbind = () => el.removeEventListener('keydown', onKeyDown);
    })
  );

  onCleanup(() => unbind?.());

  return (nextActions: ListNavActions | undefined) => {
    actions = nextActions;
  };
}

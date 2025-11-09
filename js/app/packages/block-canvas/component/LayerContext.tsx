import { createContext } from 'solid-js';

export const LayerContext = createContext<
  () => {
    base: HTMLDivElement | undefined;
    selection: HTMLDivElement | undefined;
    lineSelection: HTMLDivElement | undefined;
  }
>(() => ({
  base: undefined,
  selection: undefined,
  lineSelection: undefined,
}));

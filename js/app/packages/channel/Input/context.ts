import { createContext, useContext, type Accessor } from 'solid-js';
import type { InputCommands, InputData } from './types';

type InputContextValue = {
  view: Accessor<InputData>;
  commands: InputCommands;
};

const InputContext = createContext<InputContextValue>();
export const InputProvider = InputContext.Provider;

export function useInput(): Accessor<InputData> {
  const ctx = useContext(InputContext);
  if (!ctx) throw new Error('useInput must be used within <Input.Root>');
  return ctx.view;
}

export function useInputCommands(): InputCommands {
  const ctx = useContext(InputContext);
  if (!ctx)
    throw new Error('useInputCommands must be used within <Input.Root>');
  return ctx.commands;
}

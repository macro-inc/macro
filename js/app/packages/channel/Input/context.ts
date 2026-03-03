import { createContext, useContext, type Accessor } from 'solid-js';
import type { InputActions, InputAttachmentTracker, InputData } from './types';

const InputContext = createContext<Accessor<InputData>>();
const InputActionsContext = createContext<InputActions>();
const InputAttachmentTrackerContext = createContext<InputAttachmentTracker>();

export const InputProvider = InputContext.Provider;
export const InputActionsProvider = InputActionsContext.Provider;
export const InputAttachmentTrackerProvider =
  InputAttachmentTrackerContext.Provider;

export function useInput(): Accessor<InputData> {
  const ctx = useContext(InputContext);
  if (!ctx) throw new Error('useInput must be used within <Input.Root>');
  return ctx;
}

export function useInputActions(): InputActions | undefined {
  return useContext(InputActionsContext);
}

export function useInputAttachmentTracker():
  | InputAttachmentTracker
  | undefined {
  return useContext(InputAttachmentTrackerContext);
}

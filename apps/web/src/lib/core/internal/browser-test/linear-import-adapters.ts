import type { createTaskForAccount as createOwnedTask } from '@core/util/create';
import type { QueryAccount } from '@queries/auth/account-scope';
import { createSignal } from 'solid-js';
import { assertQueryAccount } from './task-filter-adapters';

export { useQueryClient } from '@tanstack/solid-query';
export const [taskWrites, setTaskWrites] = createSignal<
  Parameters<typeof createOwnedTask>[1][]
>([]);
export const [taskHistory, setTaskHistory] = createSignal<unknown[]>([]);
export const [notices, setNotices] = createSignal<string[]>([]);
let gate: PromiseWithResolvers<void> | undefined;
export function holdTaskWrite() {
  gate ??= Promise.withResolvers<void>();
}
export function releaseTaskWrite() {
  gate?.resolve();
  gate = undefined;
}
export async function createTaskForAccount(
  owner: QueryAccount,
  input?: Parameters<typeof createOwnedTask>[1]
) {
  assertQueryAccount(owner);
  setTaskWrites((writes) => [...writes, input]);
  if (gate) await gate.promise;
  assertQueryAccount(owner);
  return `00000000-0000-4000-8000-${String(taskWrites().length).padStart(12, '0')}`;
}
export const useUpsertToHistoryMutation = () => ({
  mutate: (input: unknown) => setTaskHistory((history) => [...history, input]),
});
export const toast = {
  success: (message: string) =>
    setNotices((messages) => [...messages, message]),
  failure: (message: string) =>
    setNotices((messages) => [...messages, message]),
};

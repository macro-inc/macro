// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/queries/harnesses/harnesses';

import { harnesses } from './fixture-state';

export function useHarnessesQuery() {
  return {
    get isSuccess() {
      return true;
    },
    get data() {
      return harnesses();
    },
  };
}

export const useRunnableHarnessesQuery = useHarnessesQuery;

export async function invalidateHarnesses() {}

const idleMutation = () => ({
  isPending: false,
  mutateAsync: async () => ({}),
});
export const usePatchHarnessMutation = idleMutation;
export const useSetHarnessTeamAccessMutation = idleMutation;

export function useHarnessDirectoryQuery() {
  return { isSuccess: true, data: [] };
}

export const useRunnableHarnessDirectoryQuery = useHarnessDirectoryQuery;

export function useHarnessResidentsQuery() {
  return { isSuccess: true, data: [] };
}

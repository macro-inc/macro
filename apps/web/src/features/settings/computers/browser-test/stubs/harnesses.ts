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

export function useHarnessResidentsQuery() {
  return { isSuccess: true, data: [] };
}

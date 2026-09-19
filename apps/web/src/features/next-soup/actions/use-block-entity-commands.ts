import { useMaybeSoup } from '@app/features/next-soup/soup-context';
import {
  type UseBlockEntityCommandsOptions,
  useBlockEntityCommands as useSharedBlockEntityCommands,
} from '@app/features/soup/actions/use-block-entity-commands';

export type { UseBlockEntityCommandsOptions };

/** Legacy adapter that supplies the old Soup context to the shared command hook. */
export const useBlockEntityCommands = (
  options: UseBlockEntityCommandsOptions = {}
) => {
  const legacyList = useMaybeSoup();
  return useSharedBlockEntityCommands({
    ...options,
    list: options.list ?? legacyList,
  });
};

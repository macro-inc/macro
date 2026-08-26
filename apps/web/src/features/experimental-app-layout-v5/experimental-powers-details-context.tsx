import type { AutomationEntity, SkillEntity } from '@entity/types/entity';
import { createContext, useContext } from 'solid-js';

/** Integration selection shown in the experimental Powers details sidebar. */
export type ExperimentalIntegrationSelection =
  | { type: 'gmail'; name: 'Gmail' }
  | { type: 'github'; name: 'GitHub' }
  | {
      type: 'pipedream';
      name: string;
      appSlug: string;
      iconUrl?: string | null;
    }
  | { type: 'mcp'; name: string; url: string };

/** Content currently shown in the experimental Powers details sidebar. */
export type ExperimentalPowersDetail =
  | { kind: 'entity'; entity: AutomationEntity | SkillEntity }
  | {
      kind: 'integration';
      integration: ExperimentalIntegrationSelection;
    }
  | { kind: 'memory' };

type ExperimentalPowersDetailsContextValue = {
  detail: () => ExperimentalPowersDetail | undefined;
  select: (detail: ExperimentalPowersDetail) => void;
  clear: () => void;
};

/** Context shared by Powers cards, rows, and the persistent details sidebar. */
export const ExperimentalPowersDetailsContext =
  createContext<ExperimentalPowersDetailsContextValue>();

/** Access the Powers details sidebar when rendered inside the Powers view. */
export function useExperimentalPowersDetails() {
  return useContext(ExperimentalPowersDetailsContext);
}

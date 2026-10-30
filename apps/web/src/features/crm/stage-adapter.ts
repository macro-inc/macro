import { toast } from '@core/component/Toast/Toast';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { useQueryClient } from '@tanstack/solid-query';
import { useDealStages } from './queries/deal-stages';
import { createCrmQueryDependencies } from './queries/dependencies';
import { useTeamCrmConfig } from './queries/team-config';
export function createAppDealStages() {
  const settings = useTeamCrmConfig(
    createCrmQueryDependencies(useQueryClient(), toast)
  );
  return useDealStages(
    useListPropertiesQuery(() => ({ scope: 'team', includeOptions: true })),
    settings
  );
}

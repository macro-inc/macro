import { toast } from '@core/component/Toast/Toast';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { storageServiceClient } from '@service-storage/client';
import { useQueryClient } from '@tanstack/solid-query';
import { useDealStages } from './queries/deal-stages';
import { useTeamCrmConfig } from './queries/team-config';
export function createAppDealStages() {
  const settings = useTeamCrmConfig({
    client: useQueryClient(),
    storage: storageServiceClient,
    feedback: toast,
  });
  return useDealStages(
    useListPropertiesQuery(() => ({ scope: 'team', includeOptions: true })),
    settings
  );
}

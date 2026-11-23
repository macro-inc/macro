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
    // The full listing other CRM surfaces already read; the team's stage
    // definition is picked out by owner, so no team-only request is needed.
    useListPropertiesQuery(() => ({ scope: 'all', includeOptions: true })),
    settings
  );
}

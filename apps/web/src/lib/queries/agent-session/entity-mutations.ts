import { analytics } from '@app/lib/analytics';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { queryClient } from '../client';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { previewKeys } from '../preview/keys';
import { invalidateAllSoup } from '../soup/cache';
import { agentSessionKeys } from './keys';
import { handleAgentSessionRenamed } from './session-metadata-sync';

function refreshSessionEntity(id: string) {
  fireAndForget(refreshActiveGraphqlPreviewQueries(id), 'agent-session-lists');
  invalidateAllSoup();
  queryClient.invalidateQueries({ queryKey: agentSessionKeys._def });
  queryClient.invalidateQueries({
    queryKey: previewKeys.item(id).queryKey,
  });
}

// Agent sessions report as `agent`, as BlockLoader reports their opens.
export async function renameAgentSession(id: string, name: string) {
  await throwOnErr(() => agentHarnessServiceClient.rename(id, name));
  analytics.track('update_entity', {
    entityType: 'agent',
    entityId: id,
    property: 'name',
  });
  handleAgentSessionRenamed({ agentSessionId: id, name });
  refreshSessionEntity(id);
}

export async function setAgentSessionArchived(id: string, isArchived: boolean) {
  await throwOnErr(() => agentHarnessServiceClient.setArchived(id, isArchived));
  refreshSessionEntity(id);
}

export async function deleteAgentSession(id: string) {
  await throwOnErr(() => agentHarnessServiceClient.delete(id));
  analytics.track('delete_entity', { entityType: 'agent', entityId: id });
  refreshSessionEntity(id);
}

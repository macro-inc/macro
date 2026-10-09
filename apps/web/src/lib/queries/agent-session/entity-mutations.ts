import { throwOnErr } from '@core/util/result';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { queryClient } from '../client';
import { refreshActiveGraphqlPreviewQueries } from '../preview/active-queries';
import { previewKeys } from '../preview/keys';
import { invalidateAllSoup } from '../soup/cache';
import { agentSessionKeys } from './keys';
import { handleAgentSessionRenamed } from './session-metadata-sync';

function refreshSessionEntity(id: string) {
  void refreshActiveGraphqlPreviewQueries(id);
  invalidateAllSoup();
  void queryClient.invalidateQueries({ queryKey: agentSessionKeys._def });
  void queryClient.invalidateQueries({
    queryKey: previewKeys.item(id).queryKey,
  });
}

export async function renameAgentSession(id: string, name: string) {
  await throwOnErr(() => agentHarnessServiceClient.rename(id, name));
  handleAgentSessionRenamed({ agentSessionId: id, name });
  refreshSessionEntity(id);
}

export async function setAgentSessionArchived(id: string, isArchived: boolean) {
  await throwOnErr(() => agentHarnessServiceClient.setArchived(id, isArchived));
  refreshSessionEntity(id);
}

export async function deleteAgentSession(id: string) {
  await throwOnErr(() => agentHarnessServiceClient.delete(id));
  refreshSessionEntity(id);
}
